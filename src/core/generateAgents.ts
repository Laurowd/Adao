import type { PackageManager, ProjectScan } from "./types.js";

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  dev: "Start development server",
  build: "Build project",
  test: "Run tests",
  lint: "Run linting",
  format: "Format code"
};

const COMMON_SCRIPT_ORDER = ["dev", "build", "test", "lint", "format"];

const STRUCTURE_DESCRIPTIONS: Record<string, string> = {
  "src/": "Main source code",
  "tests/": "Automated tests",
  "test/": "Automated tests",
  "prisma/": "Database schema and Prisma migrations",
  "app/": "Application routes or screens",
  "pages/": "Page routes",
  "components/": "Reusable UI components",
  "lib/": "Shared library code"
};

export function generateAgentsContent(scan: ProjectScan): string {
  return [
    "# AGENTS.md",
    "",
    "## Project overview",
    "",
    buildProjectOverview(scan),
    "",
    "## Tech stack",
    "",
    ...buildTechStackLines(scan),
    "",
    "## Common commands",
    "",
    ...buildCommandLines(scan),
    "",
    "## Project structure",
    "",
    ...buildProjectStructureLines(scan),
    "",
    "## Agent rules",
    "",
    "- Keep changes focused and minimal.",
    "- Prefer existing project patterns over introducing new abstractions.",
    "- Do not change package manager unless explicitly requested.",
    "- Run relevant validation commands after code changes when available.",
    "- Update this file when project commands or architecture change.",
    ""
  ].join("\n");
}

function buildProjectOverview(scan: ProjectScan): string {
  if (scan.packageDescription) {
    return scan.packageDescription;
  }

  const detectedStack = [...scan.frameworks, ...scan.languages];

  if (detectedStack.length > 0) {
    return `This appears to be the ${scan.projectName} project, using ${detectedStack
      .slice(0, 4)
      .join(", ")}.`;
  }

  return "Project objective should be filled in manually.";
}

function buildTechStackLines(scan: ProjectScan): string[] {
  const lines: string[] = [];

  if (scan.packageManager) {
    lines.push(`- Package manager: ${scan.packageManager}`);
  }

  for (const language of scan.languages) {
    lines.push(`- ${language}`);
  }

  for (const framework of scan.frameworks) {
    lines.push(`- ${framework}`);
  }

  if (lines.length === 0) {
    return ["- No primary stack detected yet."];
  }

  return lines;
}

function buildCommandLines(scan: ProjectScan): string[] {
  const lines = COMMON_SCRIPT_ORDER.filter((scriptName) =>
    Boolean(scan.scripts[scriptName])
  ).map(
    (scriptName) =>
      `- \`${formatScriptCommand(scan.packageManager, scriptName)}\`: ${COMMAND_DESCRIPTIONS[scriptName]}`
  );

  if (lines.length === 0) {
    return ["- No common package scripts detected."];
  }

  return lines;
}

function buildProjectStructureLines(scan: ProjectScan): string[] {
  const lines = scan.projectStructure.map((directory) => {
    const description =
      STRUCTURE_DESCRIPTIONS[directory] ?? "Project-specific code";

    return `- \`${directory}\`: ${description}`;
  });

  if (scan.importantFiles.includes("package.json")) {
    lines.push("- `package.json`: Node.js package metadata and scripts");
  }

  if (scan.importantFiles.includes("tsconfig.json")) {
    lines.push("- `tsconfig.json`: TypeScript compiler configuration");
  }

  if (lines.length === 0) {
    return ["- Project structure should be filled in manually."];
  }

  return lines;
}

function formatScriptCommand(
  packageManager: PackageManager,
  scriptName: string
): string {
  if (packageManager === "pnpm") {
    return `pnpm ${scriptName}`;
  }

  if (packageManager === "yarn") {
    return `yarn ${scriptName}`;
  }

  if (packageManager === "bun") {
    return `bun run ${scriptName}`;
  }

  return `npm run ${scriptName}`;
}
