#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitAgentsUpdate,
  prepareAgentsUpdate,
  readAgentsContent
} from "./core/applyAgents.js";
import { diffAgents } from "./core/diffAgents.js";
import { generateAgentsContent } from "./core/generateAgents.js";
import { scanProject } from "./core/scanProject.js";
import { createSuggestResult } from "./core/suggestAgents.js";
import type { AgentsValidationResult, ProjectScan } from "./core/types.js";
import { validateAgents } from "./core/validateAgents.js";

type ConfirmAction = (question: string) => Promise<boolean>;

export async function main(
  argv = process.argv.slice(2),
  confirmAction: ConfirmAction = askConfirmation
): Promise<void> {
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "scan") {
    await runScan(argv.slice(1));
    return;
  }

  if (command === "doctor") {
    await runDoctor(argv.slice(1));
    return;
  }

  if (command === "generate") {
    await runGenerate(argv.slice(1));
    return;
  }

  if (command === "apply") {
    await runApply(argv.slice(1), confirmAction);
    return;
  }

  if (command === "suggest") {
    await runSuggest(argv.slice(1));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function runScan(args: string[]): Promise<void> {
  const projectPath = getProjectPath(args);
  const asJson = args.includes("--json");
  const scan = await scanProject(projectPath);

  if (asJson) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }

  console.log(formatScan(scan));
}

async function runDoctor(args: string[]): Promise<void> {
  const projectPath = getProjectPath(args);
  const asJson = args.includes("--json");
  const result = await validateAgents(projectPath);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          issues: result.issues,
          summary: result.summary,
          status: result.status
        },
        null,
        2
      )
    );
  } else {
    console.log(formatValidation(result));
  }

  if (result.summary.errors > 0) {
    process.exitCode = 1;
  }
}

async function runGenerate(args: string[]): Promise<void> {
  const projectPath = getProjectPath(args);
  const scan = await scanProject(projectPath);

  console.log(generateAgentsContent(scan));
}

async function runApply(
  args: string[],
  confirmAction: ConfirmAction
): Promise<void> {
  const projectPath = getProjectPath(args);
  const assumeYes = args.includes("--yes");
  const scan = await scanProject(projectPath);
  const agentsPath = path.join(scan.absolutePath, "AGENTS.md");
  const oldContent = await readAgentsContent(agentsPath);
  const update = prepareAgentsUpdate(oldContent, generateAgentsContent(scan));

  if (oldContent !== null) {
    if (oldContent === update.nextContent) {
      console.log("AGENTS.md is already up to date.");
      return;
    }

    console.log(diffAgents(oldContent, update.nextContent));
  } else {
    console.log("AGENTS.md does not exist. Proposed content:");
    console.log("");
    console.log(update.nextContent);
  }

  if (update.kind === "create") {
    console.log(`Will create ${agentsPath}.`);
  } else if (update.kind === "managed") {
    console.log(
      `Will update only content between Adão markers in ${agentsPath} and create an available backup.`
    );
  } else {
    console.log(
      `Legacy AGENTS.md has no Adão markers. The entire file will be replaced; manual content will not be preserved in AGENTS.md. A backup will be created first.`
    );
  }

  const action = update.kind === "create" ? "create" : "update";

  const confirmed =
    assumeYes ||
    (await confirmAction(
      `${capitalize(action)} suggested AGENTS.md at ${agentsPath}?`
    ));

  if (!confirmed) {
    console.log("Aborted.");
    return;
  }

  if (assumeYes) {
    console.log(`--yes supplied; proceeding to ${action} AGENTS.md.`);
  }

  const result = await commitAgentsUpdate(agentsPath, update);

  if (result.backupPath) {
    console.log(`Backup written to ${result.backupPath}`);
  }

  console.log(`Updated ${agentsPath}`);
}

async function runSuggest(args: string[]): Promise<void> {
  const projectPath = getProjectPath(args);
  const asJson = args.includes("--json");
  const result = await createSuggestResult(projectPath);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.prompt);
}

function getProjectPath(args: string[]): string {
  const projectPath = args.find((arg) => !arg.startsWith("-"));

  if (!projectPath) {
    throw new Error("Missing projectPath.");
  }

  return projectPath;
}

function formatScan(scan: ProjectScan): string {
  const lines = [
    `Project: ${scan.projectName}`,
    `Path: ${scan.absolutePath}`,
    `Git repository: ${formatBoolean(scan.isGitRepository)}`,
    `AGENTS.md: ${formatBoolean(scan.hasAgents)}`,
    `README.md: ${formatBoolean(scan.hasReadme)}`,
    `Package manager: ${scan.packageManager ?? "not detected"}`,
    `Languages: ${formatList(scan.languages)}`,
    `Frameworks/tools: ${formatList(scan.frameworks)}`,
    `Project structure: ${formatList(scan.projectStructure)}`,
    "Scripts:",
    ...formatScripts(scan.scripts),
    `Important files: ${formatList(scan.importantFiles)}`
  ];

  return lines.join("\n");
}

function formatValidation(result: AgentsValidationResult): string {
  const lines =
    result.issues.length === 0
      ? ["No AGENTS.md issues found."]
      : result.issues.map((issue) => `[${issue.severity}] ${issue.message}`);

  return [
    ...lines,
    "",
    `Summary: ${formatCount(result.summary.errors, "error")}, ${formatCount(
      result.summary.warnings,
      "warning"
    )}, ${formatCount(result.summary.infos, "info", "infos")}`,
    `Status: ${result.status}`
  ].join("\n");
}

function formatScripts(scripts: Record<string, string>): string[] {
  const entries = Object.entries(scripts);

  if (entries.length === 0) {
    return ["  none detected"];
  }

  return entries.map(([name, value]) => `  ${name}: ${value}`);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none detected";
}

function formatBoolean(value: boolean): string {
  return value ? "yes" : "no";
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

async function askConfirmation(question: string): Promise<boolean> {
  const readline = createInterface({ input, output });
  const answer = await readline.question(`${question} [y/N] `);
  readline.close();

  return /^(y|yes)$/i.test(answer.trim());
}

function printUsage(): void {
  console.log(`Usage:
  adao scan <projectPath> [--json]
  adao doctor <projectPath>
  adao generate <projectPath>
  adao apply <projectPath>
  adao suggest <projectPath> [--json]

Examples:
  npm run dev -- scan .
  npm run dev -- doctor .
  npm run dev -- generate .
  npm run dev -- suggest .`);
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return Boolean(
    process.argv[1] &&
      path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}
