import { readFile } from "node:fs/promises";

export async function readCliVersion(): Promise<string> {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const raw = await readFile(packageJsonUrl, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    parsed.version.length === 0
  ) {
    throw new Error("Adão package.json does not contain a valid version.");
  }

  return parsed.version;
}
