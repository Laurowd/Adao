import type { PackageManager, ProjectScan } from "./types.js";
import { wrapManagedAgentsContent } from "./applyAgents.js";
import { assertCompleteProjectScan } from "./scanProject.js";

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  dev: "Start development server",
  build: "Build project",
  test: "Run tests",
  lint: "Run linting",
  format: "Format code",
  typecheck: "Run type checks",
  start: "Start the application"
};

const COMMON_SCRIPT_ORDER = [
  "dev",
  "build",
  "test",
  "lint",
  "format",
  "typecheck",
  "start"
];

const VALIDATION_SCRIPT_ORDER = ["test", "build", "lint", "typecheck"];

const STRUCTURE_DESCRIPTIONS: Record<string, string> = {
  "src/": "Main source code",
  "app/": "Application routes or screens",
  "pages/": "Page routes",
  "components/": "Reusable UI components",
  "tests/": "Automated tests",
  "__tests__/": "Automated tests",
  "docs/": "Project documentation",
  "test/": "Automated tests",
  "prisma/": "Database schema and Prisma migrations",
  "lib/": "Shared library code",
  ".github/workflows/": "GitHub Actions workflows"
};

export function generateAgentsContent(scan: ProjectScan): string {
  assertCompleteProjectScan(scan, "generate AGENTS.md");

  const validationLines = buildValidationLines(scan);
  const validationSection =
    validationLines.length > 0
      ? [
          "",
          "## Validation",
          "",
          "Before finishing code changes, run the relevant checks when possible:",
          "",
          ...validationLines
        ]
      : [];

  const content = [
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
    ...validationSection,
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

  return wrapManagedAgentsContent(content);
}

function buildProjectOverview(scan: ProjectScan): string {
  if (scan.projectOverview) {
    return scan.projectOverview;
  }

  return "TODO: describe the project goal.";
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
    return ["- TODO: document the project stack."];
  }

  return lines;
}

function buildCommandLines(scan: ProjectScan): string[] {
  const lines = sortScriptNames(Object.keys(scan.scripts)).map(
    (scriptName) =>
      `- \`${formatScriptCommand(scan.packageManager, scriptName)}\`: ${getCommandDescription(scriptName)}`
  );

  if (lines.length === 0) {
    return ["- TODO: document common commands."];
  }

  return lines;
}

function buildProjectStructureLines(scan: ProjectScan): string[] {
  const lines = scan.projectStructure.map((directory) => {
    const description =
      STRUCTURE_DESCRIPTIONS[directory] ?? "Project-specific code";

    return `- \`${directory}\`: ${description}`;
  });

  if (lines.length === 0) {
    return ["- TODO: document the relevant project structure."];
  }

  return lines;
}

function buildValidationLines(scan: ProjectScan): string[] {
  return VALIDATION_SCRIPT_ORDER.filter((scriptName) =>
    Boolean(scan.scripts[scriptName])
  ).map(
    (scriptName) =>
      `- \`${formatScriptCommand(scan.packageManager, scriptName)}\``
  );
}

function sortScriptNames(scriptNames: string[]): string[] {
  const order = new Map(
    COMMON_SCRIPT_ORDER.map((scriptName, index) => [scriptName, index])
  );

  return [...scriptNames].sort((left, right) => {
    const leftIndex = order.get(left) ?? Number.POSITIVE_INFINITY;
    const rightIndex = order.get(right) ?? Number.POSITIVE_INFINITY;

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return left.localeCompare(right);
  });
}

function getCommandDescription(scriptName: string): string {
  return COMMAND_DESCRIPTIONS[scriptName] ?? `Run the ${scriptName} script`;
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
