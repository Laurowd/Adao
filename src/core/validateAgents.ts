import os from "node:os";
import path from "node:path";
import { pathExists, readTextIfExists, statIfExists } from "../utils/fs.js";
import { readPackageJson } from "./readPackageJson.js";
import { scanProject } from "./scanProject.js";
import type {
  AgentsValidationResult,
  PackageManager,
  ProjectScan,
  ValidationIssue
} from "./types.js";

interface ValidateAgentsOptions {
  scan?: ProjectScan;
  globalAgentsPath?: string;
}

interface MentionedCommand {
  manager: Exclude<PackageManager, null>;
  scriptName: string;
  raw: string;
}

const VAGUE_PHRASES = [
  "write clean code",
  "follow best practices",
  "be careful",
  "make it scalable"
];

const PACKAGE_COMMANDS_TO_IGNORE = new Set([
  "add",
  "audit",
  "ci",
  "create",
  "dlx",
  "exec",
  "i",
  "init",
  "install",
  "remove",
  "run",
  "uninstall",
  "update",
  "x"
]);

export async function validateAgents(
  projectPath: string,
  options: ValidateAgentsOptions = {}
): Promise<AgentsValidationResult> {
  const scan = options.scan ?? (await scanProject(projectPath));
  const agentsPath = path.join(scan.absolutePath, "AGENTS.md");
  const issues: ValidationIssue[] = [];
  const agentsContent = await readTextIfExists(agentsPath);

  if (agentsContent === null) {
    issues.push({
      severity: "warning",
      code: "agents-missing",
      message: "AGENTS.md was not found."
    });

    return { scan, issues };
  }

  validateLength(agentsContent, issues);
  validateVaguePhrases(agentsContent, issues);
  await validateMentionedCommands(scan, agentsContent, issues);
  await validateMentionedStack(scan, agentsContent, issues);
  await validateFreshness(scan, issues);
  await validateGlobalConflict(scan, issues, options.globalAgentsPath);

  return { scan, issues };
}

function validateLength(content: string, issues: ValidationIssue[]): void {
  if (content.length > 8000) {
    issues.push({
      severity: "error",
      code: "agents-too-large",
      message: `AGENTS.md is too large (${content.length} characters). Keep it below 8000 characters.`
    });
    return;
  }

  if (content.length > 4000) {
    issues.push({
      severity: "warning",
      code: "agents-large",
      message: `AGENTS.md is getting large (${content.length} characters). Consider trimming it below 4000 characters.`
    });
  }
}

function validateVaguePhrases(
  content: string,
  issues: ValidationIssue[]
): void {
  const lowerContent = content.toLowerCase();

  for (const phrase of VAGUE_PHRASES) {
    if (lowerContent.includes(phrase)) {
      issues.push({
        severity: "warning",
        code: "vague-language",
        message: `AGENTS.md contains vague guidance: "${phrase}". Prefer project-specific instructions.`
      });
    }
  }
}

async function validateMentionedCommands(
  scan: ProjectScan,
  content: string,
  issues: ValidationIssue[]
): Promise<void> {
  const packageJson = await readPackageJson(scan.absolutePath);
  const scripts = packageJson?.scripts ?? {};
  const mentionedCommands = extractMentionedCommands(content);

  for (const command of mentionedCommands) {
    if (!packageJson) {
      issues.push({
        severity: "warning",
        code: "command-without-package-json",
        message: `AGENTS.md mentions \`${command.raw}\`, but package.json was not found.`
      });
      continue;
    }

    if (!scripts[command.scriptName]) {
      issues.push({
        severity: "error",
        code: "command-script-missing",
        message: `AGENTS.md mentions \`${command.raw}\`, but package.json has no "${command.scriptName}" script.`
      });
    }
  }
}

function extractMentionedCommands(content: string): MentionedCommand[] {
  const commands = new Map<string, MentionedCommand>();

  collectCommands(commands, content, /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g, "npm");
  collectCommands(commands, content, /\bnpm\s+(test|start)\b/g, "npm");
  collectCommands(
    commands,
    content,
    /\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g,
    "pnpm"
  );
  collectCommands(
    commands,
    content,
    /\byarn\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g,
    "yarn"
  );
  collectCommands(commands, content, /\bbun\s+run\s+([A-Za-z0-9:_-]+)/g, "bun");

  return [...commands.values()];
}

function collectCommands(
  commands: Map<string, MentionedCommand>,
  content: string,
  pattern: RegExp,
  manager: Exclude<PackageManager, null>
): void {
  for (const match of content.matchAll(pattern)) {
    const scriptName = match[1];

    if (!scriptName || PACKAGE_COMMANDS_TO_IGNORE.has(scriptName)) {
      continue;
    }

    const raw = match[0];
    const key = `${manager}:${scriptName}:${raw}`;

    commands.set(key, { manager, scriptName, raw });
  }
}

async function validateMentionedStack(
  scan: ProjectScan,
  content: string,
  issues: ValidationIssue[]
): Promise<void> {
  const stackRules: Array<{
    label: string;
    pattern: RegExp;
    exists: () => Promise<boolean> | boolean;
  }> = [
    {
      label: "Prisma",
      pattern: /\bprisma\b/i,
      exists: async () =>
        scan.frameworks.includes("Prisma") ||
        (await pathExists(path.join(scan.absolutePath, "prisma")))
    },
    {
      label: "React",
      pattern: /\breact\b/i,
      exists: () => scan.frameworks.includes("React")
    },
    {
      label: "Next.js",
      pattern: /\bnext(?:\.js|js)\b/i,
      exists: () => scan.frameworks.includes("Next.js")
    },
    {
      label: "Vite",
      pattern: /\bvite\b/i,
      exists: () => scan.frameworks.includes("Vite")
    },
    {
      label: "Express",
      pattern: /\bexpress\b/i,
      exists: () => scan.frameworks.includes("Express")
    },
    {
      label: "NestJS",
      pattern: /\bnestjs\b|\bnest\.js\b/i,
      exists: () => scan.frameworks.includes("NestJS")
    },
    {
      label: "Tailwind CSS",
      pattern: /\btailwind\b/i,
      exists: () => scan.frameworks.includes("Tailwind CSS")
    },
    {
      label: "Vitest",
      pattern: /\bvitest\b/i,
      exists: () => scan.frameworks.includes("Vitest")
    },
    {
      label: "Jest",
      pattern: /\bjest\b/i,
      exists: () => scan.frameworks.includes("Jest")
    },
    {
      label: "Playwright",
      pattern: /\bplaywright\b/i,
      exists: () => scan.frameworks.includes("Playwright")
    },
    {
      label: "ESLint",
      pattern: /\beslint\b/i,
      exists: () => scan.frameworks.includes("ESLint")
    },
    {
      label: "Prettier",
      pattern: /\bprettier\b/i,
      exists: () => scan.frameworks.includes("Prettier")
    },
    {
      label: "TypeScript",
      pattern: /\btypescript\b/i,
      exists: () => scan.languages.includes("TypeScript")
    },
    {
      label: "Python",
      pattern: /\bpython\b/i,
      exists: () => scan.languages.includes("Python")
    }
  ];

  for (const rule of stackRules) {
    if (rule.pattern.test(content) && !(await rule.exists())) {
      issues.push({
        severity: "warning",
        code: "stack-not-detected",
        message: `AGENTS.md mentions ${rule.label}, but it was not detected in this project.`
      });
    }
  }
}

async function validateFreshness(
  scan: ProjectScan,
  issues: ValidationIssue[]
): Promise<void> {
  const agentsPath = path.join(scan.absolutePath, "AGENTS.md");
  const agentsStat = await statIfExists(agentsPath);

  if (!agentsStat) {
    return;
  }

  const newerFiles: string[] = [];

  for (const relativeFile of [
    "package.json",
    "README.md",
    "readme.md",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
    "bun.lock"
  ]) {
    const fileStat = await statIfExists(path.join(scan.absolutePath, relativeFile));

    if (fileStat && agentsStat.mtimeMs + 1000 < fileStat.mtimeMs) {
      newerFiles.push(relativeFile);
    }
  }

  if (newerFiles.length > 0) {
    issues.push({
      severity: "warning",
      code: "agents-possibly-stale",
      message: `AGENTS.md is older than ${newerFiles.join(", ")} and may be stale.`
    });
  }
}

async function validateGlobalConflict(
  scan: ProjectScan,
  issues: ValidationIssue[],
  globalAgentsPath?: string
): Promise<void> {
  const resolvedGlobalAgentsPath =
    globalAgentsPath ?? path.join(os.homedir(), ".codex", "AGENTS.md");
  const globalContent = await readTextIfExists(resolvedGlobalAgentsPath);

  if (!globalContent || !scan.packageManager) {
    return;
  }

  const preferredPackageManager = findPreferredPackageManager(globalContent);

  if (
    preferredPackageManager &&
    preferredPackageManager !== scan.packageManager
  ) {
    issues.push({
      severity: "warning",
      code: "global-package-manager-conflict",
      message: `Global AGENTS.md appears to prefer ${preferredPackageManager}, but this project uses ${scan.packageManager}.`
    });
  }
}

function findPreferredPackageManager(content: string): PackageManager {
  for (const packageManager of ["pnpm", "npm", "yarn", "bun"] as const) {
    const pattern = new RegExp(
      `(?:sempre|always)[^\\n.]{0,80}(?:usar|use)[^\\n.]{0,30}\\b${packageManager}\\b|(?:usar|use)[^\\n.]{0,30}\\b${packageManager}\\b[^\\n.]{0,80}(?:sempre|always)`,
      "i"
    );

    if (pattern.test(content)) {
      return packageManager;
    }
  }

  return null;
}
