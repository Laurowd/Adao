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

export const DEFAULT_SCAN_ENTRY_LIMIT = 5000;

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
  maxFiles = DEFAULT_SCAN_ENTRY_LIMIT
): Promise<string[]> {
  const paths = await listProjectPathsRecursive(rootPath, maxFiles);

  return paths.files;
}

export interface ProjectPaths {
  files: string[];
  directories: string[];
  entriesScanned: number;
  entryLimit: number;
  truncated: boolean;
  unreadablePaths: UnreadableProjectPath[];
}

export interface UnreadableProjectPath {
  path: string;
  code?: string;
  category: "transient" | "permission" | "filesystem";
  blocking: boolean;
}

export async function listProjectPathsRecursive(
  rootPath: string,
  maxEntries = DEFAULT_SCAN_ENTRY_LIMIT
): Promise<ProjectPaths> {
  const files: string[] = [];
  const directories: string[] = [];
  const unreadablePaths: UnreadableProjectPath[] = [];
  const pendingDirectories: Array<{
    absolutePath: string;
    relativePath: string;
  }> = [{ absolutePath: rootPath, relativePath: "." }];
  let entriesScanned = 0;
  let truncated = false;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.shift()!;
    let entries;

    try {
      entries = await fs.readdir(currentDirectory.absolutePath, {
        withFileTypes: true
      });
    } catch (error) {
      unreadablePaths.push(toUnreadablePath(currentDirectory.relativePath, error));
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entriesScanned >= maxEntries) {
        truncated = true;
        break;
      }

      entriesScanned += 1;

      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(currentDirectory.absolutePath, entry.name);
      const relativePath = toPosixPath(path.relative(rootPath, fullPath));

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          directories.push(`${relativePath}/`);
          pendingDirectories.push({
            absolutePath: fullPath,
            relativePath: `${relativePath}/`
          });
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }

    if (truncated) {
      break;
    }
  }

  return {
    files,
    directories,
    entriesScanned,
    entryLimit: maxEntries,
    truncated,
    unreadablePaths
  };
}

function toUnreadablePath(
  relativePath: string,
  error: unknown
): UnreadableProjectPath {
  const code = getErrorCode(error);

  if (code === "ENOENT") {
    return {
      path: relativePath,
      code,
      category: "transient",
      blocking: false
    };
  }

  if (code === "EACCES" || code === "EPERM") {
    return {
      path: relativePath,
      code,
      category: "permission",
      blocking: true
    };
  }

  return {
    path: relativePath,
    code,
    category: "filesystem",
    blocking: true
  };
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
