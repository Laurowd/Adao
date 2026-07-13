import { promises as fs } from "node:fs";
import path from "node:path";
import type { PackageJson } from "./types.js";

export type PackageJsonErrorKind =
  | "unreadable"
  | "empty"
  | "malformed"
  | "invalid-root"
  | "invalid-field";

export class PackageJsonError extends Error {
  readonly kind: PackageJsonErrorKind;
  readonly packageJsonPath: string;

  constructor(
    kind: PackageJsonErrorKind,
    packageJsonPath: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PackageJsonError";
    this.kind = kind;
    this.packageJsonPath = packageJsonPath;
  }
}

const STRING_FIELDS = ["name", "description", "packageManager"] as const;
const STRING_RECORD_FIELDS = [
  "scripts",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
] as const;

export async function readPackageJson(
  projectPath: string
): Promise<PackageJson | null> {
  const packageJsonPath = path.resolve(projectPath, "package.json");
  let raw: string;

  try {
    raw = await fs.readFile(packageJsonPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }

    const code = getErrorCode(error);
    throw new PackageJsonError(
      "unreadable",
      packageJsonPath,
      `Cannot read package.json at ${packageJsonPath}${code ? ` (${code})` : ""}. Check that it is a readable file and that permissions allow access.`,
      { cause: error }
    );
  }

  if (raw.trim() === "") {
    throw new PackageJsonError(
      "empty",
      packageJsonPath,
      `package.json at ${packageJsonPath} is empty. Add a valid JSON object or remove the file.`
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new PackageJsonError(
      "malformed",
      packageJsonPath,
      `package.json at ${packageJsonPath} contains malformed JSON.${detail}`,
      { cause: error }
    );
  }

  if (!isJsonObject(parsed)) {
    throw new PackageJsonError(
      "invalid-root",
      packageJsonPath,
      `package.json at ${packageJsonPath} must contain a JSON object at its root; received ${describeValue(parsed)}.`
    );
  }

  const packageJson: PackageJson = {};

  for (const field of STRING_FIELDS) {
    if (!Object.hasOwn(parsed, field)) {
      continue;
    }

    const value = parsed[field];

    if (typeof value !== "string") {
      throw invalidFieldError(
        packageJsonPath,
        field,
        "a string",
        value
      );
    }

    packageJson[field] = value;
  }

  for (const field of STRING_RECORD_FIELDS) {
    if (!Object.hasOwn(parsed, field)) {
      continue;
    }

    const value = parsed[field];

    if (!isJsonObject(value)) {
      throw invalidFieldError(
        packageJsonPath,
        field,
        "an object whose values are strings",
        value
      );
    }

    const validatedEntries: Array<[string, string]> = [];

    for (const [entryName, entryValue] of Object.entries(value)) {
      if (typeof entryValue !== "string") {
        throw invalidFieldError(
          packageJsonPath,
          `${field}.${entryName}`,
          "a string",
          entryValue
        );
      }

      validatedEntries.push([entryName, entryValue]);
    }

    packageJson[field] = Object.fromEntries(validatedEntries);
  }

  return packageJson;
}

function invalidFieldError(
  packageJsonPath: string,
  field: string,
  expected: string,
  value: unknown
): PackageJsonError {
  return new PackageJsonError(
    "invalid-field",
    packageJsonPath,
    `package.json at ${packageJsonPath} has invalid field "${field}": expected ${expected}, received ${describeValue(value)}.`
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "an array";
  }

  return typeof value;
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return getErrorCode(error) === code;
}
