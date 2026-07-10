import path from "node:path";
import { readTextIfExists } from "../utils/fs.js";
import type { PackageJson } from "./types.js";

export async function readPackageJson(
  projectPath: string
): Promise<PackageJson | null> {
  const packageJsonPath = path.join(projectPath, "package.json");
  const raw = await readTextIfExists(packageJsonPath);

  if (raw === null) {
    return null;
  }

  return JSON.parse(raw) as PackageJson;
}
