import type {
  MainLanguage,
  PackageJson,
  PackageManager,
  PackageManagerEvidence
} from "./types.js";

const LANGUAGE_RULES: Array<{ language: MainLanguage; extensions: string[] }> = [
  { language: "TypeScript", extensions: [".ts", ".tsx", ".mts", ".cts"] },
  { language: "JavaScript", extensions: [".js", ".jsx", ".mjs", ".cjs"] },
  { language: "Python", extensions: [".py"] },
  { language: "Java", extensions: [".java"] },
  { language: "C#", extensions: [".cs"] },
  {
    language: "C/C++",
    extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"]
  },
  { language: "Rust", extensions: [".rs"] },
  { language: "Go", extensions: [".go"] }
];

const IMPORTANT_EXACT_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "Dockerfile",
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
  "prisma/schema.prisma",
  ".env.example"
]);

const PROJECT_STRUCTURE_DIRS = [
  "src",
  "app",
  "pages",
  "components",
  "tests",
  "__tests__",
  "docs",
  "test",
  "prisma",
  "lib"
];

const SPECIAL_STRUCTURE_DIRS = [".github/workflows/"];

export function detectPackageManager(files: string[]): PackageManager {
  const fileSet = new Set(files);

  if (fileSet.has("pnpm-lock.yaml")) {
    return "pnpm";
  }

  if (fileSet.has("package-lock.json")) {
    return "npm";
  }

  if (fileSet.has("yarn.lock")) {
    return "yarn";
  }

  if (fileSet.has("bun.lockb") || fileSet.has("bun.lock")) {
    return "bun";
  }

  return null;
}

export function resolvePackageManager(
  files: string[],
  packageManagerValue?: string
): { packageManager: PackageManager; evidence: PackageManagerEvidence } {
  const lockfile = detectPackageManager(files);
  const packageJson = parsePackageManagerValue(packageManagerValue);
  const conflict =
    lockfile !== null && packageJson !== null && lockfile !== packageJson;

  return {
    packageManager: conflict ? null : (lockfile ?? packageJson),
    evidence: {
      lockfile,
      packageJson,
      packageJsonValue: packageManagerValue,
      conflict
    }
  };
}

function parsePackageManagerValue(value?: string): PackageManager {
  const match = value?.match(/^(npm|pnpm|yarn|bun)@[^\s]+$/);

  switch (match?.[1]) {
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      return match[1];
    default:
      return null;
  }
}

export function detectLanguages(files: string[]): MainLanguage[] {
  const detected = new Set<MainLanguage>();

  for (const file of files) {
    const lowerFile = file.toLowerCase();

    for (const rule of LANGUAGE_RULES) {
      if (rule.extensions.some((extension) => lowerFile.endsWith(extension))) {
        detected.add(rule.language);
      }
    }
  }

  return LANGUAGE_RULES.map((rule) => rule.language).filter((language) =>
    detected.has(language)
  );
}

export function detectFrameworksAndTools(
  packageJson: PackageJson | null
): string[] {
  const dependencies = getAllDependencies(packageJson);
  const detected: string[] = [];

  addIfDependency(detected, dependencies, "React", ["react"]);
  addIfDependency(detected, dependencies, "Next.js", ["next"]);
  addIfDependency(detected, dependencies, "Vite", ["vite"]);
  addIfDependency(detected, dependencies, "Express", ["express"]);
  addIfDependency(detected, dependencies, "Fastify", ["fastify"]);
  addIfDependency(detected, dependencies, "NestJS", ["@nestjs/core"]);
  addIfDependency(detected, dependencies, "Prisma", ["prisma", "@prisma/client"]);
  addIfDependency(detected, dependencies, "PostgreSQL", ["postgres"]);
  addIfDependency(detected, dependencies, "Tailwind CSS", ["tailwindcss"]);
  addIfDependency(detected, dependencies, "Vitest", ["vitest"]);
  addIfDependency(detected, dependencies, "Jest", ["jest"]);
  addIfDependency(detected, dependencies, "Playwright", [
    "@playwright/test",
    "playwright"
  ]);
  addIfDependency(detected, dependencies, "Cypress", ["cypress"]);
  addIfDependency(detected, dependencies, "ESLint", ["eslint"]);
  addIfDependency(detected, dependencies, "Prettier", ["prettier"]);

  return detected;
}

export function detectImportantFiles(files: string[]): string[] {
  return files.filter(
    (file) =>
      IMPORTANT_EXACT_FILES.has(file) ||
      /^vite\.config\./.test(file) ||
      /^next\.config\./.test(file) ||
      /^eslint\.config\./.test(file)
  );
}

export function detectProjectStructure(
  files: string[],
  directories: string[] = []
): string[] {
  const structure = new Set<string>();

  for (const directory of directories) {
    const normalizedDirectory = directory.replace(/\/+$/, "");

    if (PROJECT_STRUCTURE_DIRS.includes(normalizedDirectory)) {
      structure.add(`${normalizedDirectory}/`);
    }

    if (directory === ".github/workflows/") {
      structure.add(directory);
    }
  }

  for (const file of files) {
    const [topLevel] = file.split("/");

    if (topLevel && PROJECT_STRUCTURE_DIRS.includes(topLevel)) {
      structure.add(`${topLevel}/`);
    }

    if (file.startsWith(".github/workflows/")) {
      structure.add(".github/workflows/");
    }
  }

  return [
    ...PROJECT_STRUCTURE_DIRS.map((directory) => `${directory}/`),
    ...SPECIAL_STRUCTURE_DIRS
  ].filter((directory) => structure.has(directory));
}

function getAllDependencies(packageJson: PackageJson | null): Set<string> {
  const dependencies = new Set<string>();

  if (!packageJson) {
    return dependencies;
  }

  for (const group of [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies
  ]) {
    for (const dependencyName of Object.keys(group ?? {})) {
      dependencies.add(dependencyName);
    }
  }

  return dependencies;
}

function addIfDependency(
  detected: string[],
  dependencies: Set<string>,
  label: string,
  packageNames: string[]
): void {
  if (packageNames.some((packageName) => dependencies.has(packageName))) {
    detected.push(label);
  }
}
