#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { diffAgents } from "./core/diffAgents.js";
import { generateAgentsContent } from "./core/generateAgents.js";
import { scanProject } from "./core/scanProject.js";
import type { AgentsValidationResult, ProjectScan } from "./core/types.js";
import { validateAgents } from "./core/validateAgents.js";
import { readTextIfExists } from "./utils/fs.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
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
    await runApply(argv.slice(1));
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
  const result = await validateAgents(projectPath);

  console.log(formatValidation(result));

  if (result.issues.some((issue) => issue.severity === "error")) {
    process.exitCode = 1;
  }
}

async function runGenerate(args: string[]): Promise<void> {
  const projectPath = getProjectPath(args);
  const scan = await scanProject(projectPath);

  console.log(generateAgentsContent(scan));
}

async function runApply(args: string[]): Promise<void> {
  const projectPath = getProjectPath(args);
  const scan = await scanProject(projectPath);
  const agentsPath = path.join(scan.absolutePath, "AGENTS.md");
  const oldContent = await readTextIfExists(agentsPath);
  const newContent = generateAgentsContent(scan);

  if (oldContent !== null) {
    if (oldContent === newContent) {
      console.log("AGENTS.md is already up to date.");
      return;
    }

    console.log(diffAgents(oldContent, newContent));
  } else {
    console.log("AGENTS.md does not exist. Proposed content:");
    console.log("");
    console.log(newContent);
  }

  const confirmed = await askConfirmation(
    `Write suggested AGENTS.md to ${agentsPath}?`
  );

  if (!confirmed) {
    console.log("Aborted.");
    return;
  }

  if (oldContent !== null) {
    await fs.copyFile(agentsPath, `${agentsPath}.bak`);
    console.log(`Backup written to ${agentsPath}.bak`);
  }

  await fs.writeFile(agentsPath, newContent, "utf8");
  console.log(`Updated ${agentsPath}`);
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
  if (result.issues.length === 0) {
    return "No AGENTS.md issues found.";
  }

  return result.issues
    .map((issue) => `[${issue.severity}] ${issue.message}`)
    .join("\n");
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

Examples:
  npm run dev -- scan .
  npm run dev -- doctor .
  npm run dev -- generate .`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
