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
import type { ProjectScan } from "./types.js";
import { listFilesRecursive, pathExists, statIfExists } from "../utils/fs.js";
import { resolveProjectPath } from "../utils/paths.js";

export async function scanProject(projectPath: string): Promise<ProjectScan> {
  const absolutePath = resolveProjectPath(projectPath);
  const stat = await fs.stat(absolutePath);

  if (!stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${absolutePath}`);
  }

  const files = await listFilesRecursive(absolutePath);
  const packageJson = await readPackageJson(absolutePath);
  const scripts = packageJson?.scripts ?? {};
  const projectName = packageJson?.name ?? path.basename(absolutePath);

  return {
    projectName,
    packageDescription: packageJson?.description,
    absolutePath,
    isGitRepository: await isGitRepository(absolutePath),
    hasAgents: files.includes("AGENTS.md"),
    hasReadme: files.some((file) => /^readme\.md$/i.test(file)),
    packageManager: detectPackageManager(files),
    languages: detectLanguages(files),
    frameworks: detectFrameworksAndTools(packageJson),
    scripts,
    importantFiles: detectImportantFiles(files),
    projectStructure: detectProjectStructure(files)
  };
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
