#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { realpathSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CliUsageError,
  parseCliArgs,
  recognizesJsonErrorMode,
  type CommandName,
  type ParsedCliInput
} from "./cliArgs.js";
import {
  commitAgentsUpdate,
  prepareAgentsUpdate,
  readAgentsContent
} from "./core/applyAgents.js";
import { diffAgents } from "./core/diffAgents.js";
import { generateAgentsContent } from "./core/generateAgents.js";
import {
  assertCompleteProjectScan,
  assertNoPackageManagerConflict,
  assertRecognizedPackageManagerDeclaration,
  formatIncompleteScanReasons,
  scanProject,
  type ScanProjectOptions
} from "./core/scanProject.js";
import { createSuggestResult } from "./core/suggestAgents.js";
import type { AgentsValidationResult, ProjectScan } from "./core/types.js";
import { validateAgents } from "./core/validateAgents.js";
import { readCliVersion } from "./packageVersion.js";

type ConfirmAction = (question: string) => Promise<boolean>;

export async function main(
  argv = process.argv.slice(2),
  confirmAction: ConfirmAction = askConfirmation,
  scanOptions: ScanProjectOptions = {}
): Promise<void> {
  const jsonErrorMode = recognizesJsonErrorMode(argv);
  let parsed: ParsedCliInput;

  try {
    parsed = parseCliArgs(argv);
  } catch (error: unknown) {
    reportCliError("usage", error, jsonErrorMode);
    process.exitCode = 2;
    return;
  }

  try {
    if (parsed.kind === "global-help") {
      printGlobalHelp();
    } else if (parsed.kind === "version") {
      console.log(await readCliVersion());
    } else if (parsed.kind === "command-help") {
      printCommandHelp(parsed.command);
    } else {
      await runCommand(parsed, confirmAction, scanOptions);
    }
  } catch (error: unknown) {
    reportCliError("operational", error, parsed.kind === "command" && parsed.json);
    process.exitCode = 1;
  }
}

async function runScan(
  projectPath: string,
  asJson: boolean,
  scanOptions: ScanProjectOptions
): Promise<void> {
  const scan = await scanProject(projectPath, scanOptions);

  if (asJson) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }

  console.log(formatScan(scan));
}

async function runDoctor(
  projectPath: string,
  asJson: boolean,
  scanOptions: ScanProjectOptions
): Promise<void> {
  const scan = await scanProject(projectPath, scanOptions);
  const result = await validateAgents(projectPath, { scan });

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

async function runGenerate(
  projectPath: string,
  scanOptions: ScanProjectOptions
): Promise<void> {
  const scan = await scanProject(projectPath, scanOptions);

  console.log(generateAgentsContent(scan));
}

async function runApply(
  projectPath: string,
  assumeYes: boolean,
  confirmAction: ConfirmAction,
  scanOptions: ScanProjectOptions
): Promise<void> {
  const scan = await scanProject(projectPath, scanOptions);
  assertCompleteProjectScan(scan, "apply AGENTS.md");
  assertNoPackageManagerConflict(scan, "apply AGENTS.md");
  assertRecognizedPackageManagerDeclaration(scan, "apply AGENTS.md");
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

async function runSuggest(
  projectPath: string,
  asJson: boolean,
  scanOptions: ScanProjectOptions
): Promise<void> {
  const result = await createSuggestResult(projectPath, scanOptions);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.prompt);
}

async function runCommand(
  parsed: Extract<ParsedCliInput, { kind: "command" }>,
  confirmAction: ConfirmAction,
  scanOptions: ScanProjectOptions
): Promise<void> {
  switch (parsed.command) {
    case "scan":
      await runScan(parsed.projectPath, parsed.json, scanOptions);
      return;
    case "doctor":
      await runDoctor(parsed.projectPath, parsed.json, scanOptions);
      return;
    case "generate":
      await runGenerate(parsed.projectPath, scanOptions);
      return;
    case "suggest":
      await runSuggest(parsed.projectPath, parsed.json, scanOptions);
      return;
    case "apply":
      await runApply(parsed.projectPath, parsed.yes, confirmAction, scanOptions);
  }
}

function formatScan(scan: ProjectScan): string {
  const lines = [
    `Project: ${scan.projectName}`,
    `Path: ${scan.absolutePath}`,
    `Git repository: ${formatBoolean(scan.isGitRepository)}`,
    `AGENTS.md: ${formatBoolean(scan.hasAgents)}`,
    `README.md: ${formatBoolean(scan.hasReadme)}`,
    `Package manager: ${formatPackageManager(scan)}`,
    `Languages: ${formatList(scan.languages)}`,
    `Frameworks/tools: ${formatList(scan.frameworks)}`,
    `Project structure: ${formatList(scan.projectStructure)}`,
    "Scripts:",
    ...formatScripts(scan.scripts),
    `Important files: ${formatList(scan.importantFiles)}`,
    `Scan completeness: ${scan.scanMetadata.complete ? "complete" : "incomplete"}`,
    `Entries scanned: ${scan.scanMetadata.entriesScanned} (limit: ${scan.scanMetadata.entryLimit})`,
    `Unreadable paths: ${formatUnreadablePaths(scan)}`
  ];

  if (!scan.scanMetadata.complete) {
    lines.push(
      `WARNING: Scan results are partial and must not be used for generate, suggest, or apply (${formatIncompleteScanReasons(scan)}).`
    );
  }

  return lines.join("\n");
}

function formatPackageManager(scan: ProjectScan): string {
  if (scan.packageManagerEvidence.conflict) {
    return `conflict (lockfile: ${scan.packageManagerEvidence.lockfile}, package.json: ${scan.packageManagerEvidence.packageJsonValue})`;
  }

  if (scan.packageManager) {
    return scan.packageManager;
  }

  if (scan.packageManagerEvidence.packageJsonValue) {
    return `not detected (unrecognized package.json value: ${scan.packageManagerEvidence.packageJsonValue})`;
  }

  return "not detected";
}

function formatUnreadablePaths(scan: ProjectScan): string {
  if (scan.scanMetadata.unreadablePaths.length === 0) {
    return "none";
  }

  return scan.scanMetadata.unreadablePaths
    .map(
      (unreadable) =>
        `${unreadable.path} [${unreadable.code ?? unreadable.category}]${unreadable.blocking ? "" : " (transient)"}`
    )
    .join(", ");
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

function printGlobalHelp(): void {
  console.log(`Adão maintains reliable AGENTS.md files from local project evidence.

Usage:
  adao <command> <projectPath> [flags]
  adao --help
  adao --version

Commands:
  adao scan <projectPath> [--json]
      Scan project structure and detected Node.js/TypeScript evidence.
  adao doctor <projectPath> [--json]
      Validate the existing AGENTS.md.
  adao generate <projectPath>
      Print deterministic suggested AGENTS.md content.
  adao suggest <projectPath> [--json]
      Build a deterministic suggestion prompt from local evidence.
  adao apply <projectPath> [--yes]
      Preview and optionally apply the suggested AGENTS.md.

Global flags:
  --help, -h       Show global or command help.
  --version, -V    Show the Adão version.

Examples:
  adao scan . --json
  adao apply . --yes`);
}

function printCommandHelp(command: CommandName): void {
  const help: Record<CommandName, string> = {
    scan: `Usage: adao scan <projectPath> [--json]

Scan project structure and detected Node.js/TypeScript evidence.

Flags:
  --json       Print the scan as JSON.
  --help, -h   Show this help.

Example:
  adao scan . --json`,
    doctor: `Usage: adao doctor <projectPath> [--json]

Validate the existing AGENTS.md against detected project evidence.

Flags:
  --json       Print the validation result as JSON.
  --help, -h   Show this help.

Example:
  adao doctor . --json`,
    generate: `Usage: adao generate <projectPath>

Print deterministic suggested AGENTS.md content without writing files.

Flags:
  --help, -h   Show this help.

Example:
  adao generate .`,
    suggest: `Usage: adao suggest <projectPath> [--json]

Build a deterministic suggestion prompt from local project evidence.

Flags:
  --json       Print the suggestion result as JSON.
  --help, -h   Show this help.

Example:
  adao suggest . --json`,
    apply: `Usage: adao apply <projectPath> [--yes]

Preview and optionally apply the suggested AGENTS.md safely.

Flags:
  --yes        Apply without interactive confirmation.
  --help, -h   Show this help.

Example:
  adao apply . --yes`
  };

  console.log(help[command]);
}

function reportCliError(
  type: "usage" | "operational",
  error: unknown,
  asJson: boolean
): void {
  const message = error instanceof Error ? error.message : String(error);

  if (asJson) {
    console.error(JSON.stringify({ error: { type, message } }));
    return;
  }

  const label = error instanceof CliUsageError ? "Usage error" : "Error";
  console.error(`${label}: ${message}`);
}

if (isDirectRun()) {
  void main();
}

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return (
      realpathSync(path.resolve(process.argv[1])) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}
