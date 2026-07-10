import path from "node:path";

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function resolveProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}
