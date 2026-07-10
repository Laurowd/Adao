import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { toPosixPath } from "./paths.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "target",
  "vendor"
]);

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function statIfExists(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function listFilesRecursive(
  rootPath: string,
  maxFiles = 5000
): Promise<string[]> {
  const paths = await listProjectPathsRecursive(rootPath, maxFiles);

  return paths.files;
}

export interface ProjectPaths {
  files: string[];
  directories: string[];
}

export async function listProjectPathsRecursive(
  rootPath: string,
  maxEntries = 5000
): Promise<ProjectPaths> {
  const files: string[] = [];
  const directories: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    if (files.length + directories.length >= maxEntries) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length + directories.length >= maxEntries) {
        return;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);
      const relativePath = toPosixPath(path.relative(rootPath, fullPath));

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          directories.push(`${relativePath}/`);
          await walk(fullPath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await walk(rootPath);
  return { files, directories };
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
