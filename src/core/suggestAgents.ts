import { promises as fs } from "node:fs";
import path from "node:path";
import { generateAgentsContent } from "./generateAgents.js";
import {
  assertCompleteProjectScan,
  scanProject,
  type ScanProjectOptions
} from "./scanProject.js";
import type {
  AgentsValidationResult,
  EvidenceFile,
  ProjectScan,
  SuggestResult
} from "./types.js";
import { validateAgents } from "./validateAgents.js";
import { listProjectPathsRecursive, pathExists } from "../utils/fs.js";

const MAX_FILE_CHARS = 12_000;
const MAX_EVIDENCE_CHARS = 40_000;
const GROUP_LIMIT = 5;

const EXACT_EVIDENCE_FILES = [
  "package.json",
  "AGENTS.md",
  "src/server.ts",
  "src/index.ts",
  "src/main.ts",
  "src/app.ts"
];

const GROUP_EVIDENCE_PATTERNS = [
  /^src\/services\/[^/]+\.ts$/,
  /^src\/routes\/[^/]+\.ts$/,
  /^src\/controllers\/[^/]+\.ts$/,
  /^src\/database\/[^/]+\.ts$/
];

export async function createSuggestResult(
  projectPath: string,
  scanOptions: ScanProjectOptions = {}
): Promise<SuggestResult> {
  const scan = await scanProject(projectPath, scanOptions);
  assertCompleteProjectScan(scan, "create suggestion");
  const generatedAgents = generateAgentsContent(scan);
  const validationResult = await validateAgents(projectPath, { scan });
  const evidenceFiles = await selectEvidenceFiles(scan);
  const validation = toPromptValidation(validationResult);
  const prompt = buildSuggestPrompt({
    scan,
    validation,
    generatedAgents,
    evidenceFiles
  });

  return {
    scan,
    validation,
    generatedAgents,
    evidenceFiles,
    prompt
  };
}

async function selectEvidenceFiles(scan: ProjectScan): Promise<EvidenceFile[]> {
  const projectPaths = await listProjectPathsRecursive(
    scan.absolutePath,
    scan.scanMetadata.entryLimit
  );

  if (
    projectPaths.truncated ||
    projectPaths.unreadablePaths.some((unreadable) => unreadable.blocking)
  ) {
    throw new Error(
      "Cannot create suggestion: evidence scan became incomplete while reading the project."
    );
  }

  const { files } = projectPaths;
  const candidatePaths = selectEvidencePaths(files);
  const evidenceFiles: EvidenceFile[] = [];
  let remainingChars = MAX_EVIDENCE_CHARS;

  for (const relativePath of candidatePaths) {
    if (remainingChars <= 0) {
      break;
    }

    const file = await readEvidenceFile(scan.absolutePath, relativePath);

    if (!file) {
      continue;
    }

    if (file.content.length > remainingChars) {
      evidenceFiles.push({
        path: file.path,
        content: file.content.slice(0, remainingChars),
        truncated: true
      });
      break;
    }

    evidenceFiles.push(file);
    remainingChars -= file.content.length;
  }

  return evidenceFiles;
}

function selectEvidencePaths(files: string[]): string[] {
  const fileSet = new Set(files);
  const selected: string[] = [];
  const readmePath = files.find((file) => /^readme\.md$/i.test(file));

  if (readmePath) {
    selected.push(readmePath);
  }

  for (const exactFile of EXACT_EVIDENCE_FILES) {
    if (fileSet.has(exactFile)) {
      selected.push(exactFile);
    }
  }

  for (const pattern of GROUP_EVIDENCE_PATTERNS) {
    selected.push(...files.filter((file) => pattern.test(file)).slice(0, GROUP_LIMIT));
  }

  return [...new Set(selected)];
}

async function readEvidenceFile(
  absolutePath: string,
  relativePath: string
): Promise<EvidenceFile | null> {
  const fullPath = path.join(absolutePath, relativePath);

  if (!(await pathExists(fullPath))) {
    return null;
  }

  const handle = await fs.open(fullPath, "r");

  try {
    const buffer = Buffer.alloc(MAX_FILE_CHARS + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const rawContent = buffer.subarray(0, bytesRead).toString("utf8");
    const truncated = bytesRead > MAX_FILE_CHARS || rawContent.length > MAX_FILE_CHARS;

    return {
      path: relativePath,
      content: rawContent.slice(0, MAX_FILE_CHARS),
      truncated
    };
  } finally {
    await handle.close();
  }
}

function toPromptValidation(result: AgentsValidationResult): SuggestResult["validation"] {
  return {
    issues: result.issues,
    summary: result.summary,
    status: result.status
  };
}

function buildSuggestPrompt(result: Omit<SuggestResult, "prompt">): string {
  return [
    "# Improve AGENTS.md",
    "",
    "You are helping revise a local project's AGENTS.md for AI coding agents.",
    "",
    "## Instructions",
    "",
    "- Improve or review the AGENTS.md for this project.",
    "- Use only the evidence provided in this prompt.",
    "- Do not invent the project goal, stack, commands, architecture, conventions, or workflows.",
    "- When evidence is missing, write an explicit TODO instead of guessing.",
    "- Keep AGENTS.md short, practical, and specific to this project.",
    "- Preserve detected commands unless the evidence clearly shows they are wrong.",
    "- Suggest specific agent rules only when there is evidence for them.",
    "- Return only the proposed AGENTS.md content.",
    "",
    "## Local scan",
    "",
    jsonBlock(toPromptScan(result.scan)),
    "",
    "## Current doctor result",
    "",
    jsonBlock(result.validation),
    "",
    "## Current generated AGENTS.md",
    "",
    markdownBlock(result.generatedAgents),
    "",
    "## Evidence files",
    "",
    ...formatEvidenceFiles(result.evidenceFiles)
  ].join("\n");
}

function toPromptScan(scan: ProjectScan): Record<string, unknown> {
  return {
    projectName: scan.projectName,
    absolutePath: scan.absolutePath,
    hasAgents: scan.hasAgents,
    hasReadme: scan.hasReadme,
    packageManager: scan.packageManager,
    languages: scan.languages,
    frameworks: scan.frameworks,
    scripts: scan.scripts,
    importantFiles: scan.importantFiles,
    projectStructure: scan.projectStructure,
    projectOverview: scan.projectOverview,
    projectOverviewSource: scan.projectOverviewSource,
    scanMetadata: scan.scanMetadata
  };
}

function formatEvidenceFiles(evidenceFiles: EvidenceFile[]): string[] {
  if (evidenceFiles.length === 0) {
    return ["No conservative evidence files were selected."];
  }

  return evidenceFiles.flatMap((file) => [
    `### ${file.path}`,
    "",
    textBlock(`${file.content}${file.truncated ? "\n[truncated]" : ""}`),
    ""
  ]);
}

function jsonBlock(value: unknown): string {
  return fencedBlock("json", JSON.stringify(value, null, 2));
}

function markdownBlock(value: string): string {
  return fencedBlock("markdown", value);
}

function textBlock(value: string): string {
  return fencedBlock("text", value);
}

function fencedBlock(language: string, value: string): string {
  const maxBacktickRun = Math.max(
    3,
    ...[...value.matchAll(/`+/g)].map((match) => match[0].length)
  );
  const fence = "`".repeat(maxBacktickRun + 1);

  return `${fence}${language}\n${value}\n${fence}`;
}
