import { promises as fs } from "node:fs";
import path from "node:path";
import {
  detectFrameworksAndTools,
  detectImportantFiles,
  detectLanguages,
  detectPackageManager,
  detectProjectStructure
} from "./detectStack.js";
import { readPackageJson } from "./readPackageJson.js";
import type { PackageJson, ProjectScan } from "./types.js";
import {
  listProjectPathsRecursive,
  pathExists,
  readTextIfExists,
  statIfExists
} from "../utils/fs.js";
import { resolveProjectPath } from "../utils/paths.js";

export async function scanProject(projectPath: string): Promise<ProjectScan> {
  const absolutePath = resolveProjectPath(projectPath);
  const stat = await fs.stat(absolutePath);

  if (!stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${absolutePath}`);
  }

  const { files, directories } = await listProjectPathsRecursive(absolutePath);
  const packageJson = await readPackageJson(absolutePath);
  const scripts = packageJson?.scripts ?? {};
  const projectName = packageJson?.name ?? path.basename(absolutePath);
  const readmePath = files.find((file) => /^readme\.md$/i.test(file));
  const readmeContent = readmePath
    ? await readTextIfExists(path.join(absolutePath, readmePath))
    : null;
  const overview = detectProjectOverview(packageJson, readmeContent);

  return {
    projectName,
    packageDescription: packageJson?.description,
    projectOverview: overview?.text,
    projectOverviewSource: overview?.source,
    absolutePath,
    isGitRepository: await isGitRepository(absolutePath),
    hasAgents: files.includes("AGENTS.md"),
    hasReadme: files.some((file) => /^readme\.md$/i.test(file)),
    packageManager: detectPackageManager(files),
    languages: detectLanguages(files),
    frameworks: detectFrameworksAndTools(packageJson),
    scripts,
    importantFiles: detectImportantFiles(files),
    projectStructure: detectProjectStructure(files, directories)
  };
}

function detectProjectOverview(
  packageJson: PackageJson | null,
  readmeContent: string | null
): { text: string; source: "package.json" | "README.md" } | null {
  const packageDescription = normalizeOverviewText(packageJson?.description);

  if (packageDescription) {
    return { text: packageDescription, source: "package.json" };
  }

  const readmeOverview = extractReadmeOverview(readmeContent);

  if (readmeOverview) {
    return { text: readmeOverview, source: "README.md" };
  }

  return null;
}

function extractReadmeOverview(content: string | null): string | null {
  if (!content) {
    return null;
  }

  let currentParagraph: string[] = [];
  let insideFence = false;

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("```")) {
      insideFence = !insideFence;
      continue;
    }

    const heading = trimmedLine.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];

    if (heading) {
      const overview = normalizeOverviewText(currentParagraph.join(" "));

      if (overview) {
        return overview;
      }

      return normalizeOverviewText(heading);
    }

    if (insideFence || isIgnoredReadmeLine(trimmedLine)) {
      continue;
    }

    if (trimmedLine === "") {
      const overview = normalizeOverviewText(currentParagraph.join(" "));

      if (overview) {
        return overview;
      }

      currentParagraph = [];
      continue;
    }

    currentParagraph.push(trimmedLine);
  }

  return normalizeOverviewText(currentParagraph.join(" "));
}

function isIgnoredReadmeLine(line: string): boolean {
  return (
    line === "" ||
    line.startsWith("#") ||
    line.startsWith("![") ||
    line.startsWith("[![") ||
    line.startsWith("|") ||
    line.startsWith("<!--") ||
    line.startsWith("<p") ||
    line.startsWith("<div")
  );
}

function normalizeOverviewText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!/[A-Za-z0-9]/.test(normalized)) {
    return null;
  }

  return normalized;
}

async function isGitRepository(absolutePath: string): Promise<boolean> {
  const gitPath = path.join(absolutePath, ".git");
  const gitStat = await statIfExists(gitPath);

  if (!gitStat) {
    return false;
  }

  if (gitStat.isFile()) {
    return true;
  }

  return gitStat.isDirectory() && (await pathExists(path.join(gitPath, "HEAD")));
}
