import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PackageJsonError,
  readPackageJson,
  type PackageJsonErrorKind
} from "../src/core/readPackageJson.js";

const tempDirs: string[] = [];

describe("readPackageJson", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("returns null when package.json is absent", async () => {
    const fixture = await createFixture();

    await expect(readPackageJson(fixture)).resolves.toBeNull();
  });

  it("returns only validated fields from valid JSON", async () => {
    const fixture = await createFixture();
    await writePackageJson(fixture, {
      name: "demo",
      description: "Demo package",
      packageManager: "pnpm@9.1.0",
      scripts: { test: "vitest run" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { vitest: "^3.0.0" },
      peerDependencies: { typescript: ">=5" },
      optionalDependencies: { fsevents: "^2.0.0" },
      private: true
    });

    await expect(readPackageJson(fixture)).resolves.toEqual({
      name: "demo",
      description: "Demo package",
      packageManager: "pnpm@9.1.0",
      scripts: { test: "vitest run" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { vitest: "^3.0.0" },
      peerDependencies: { typescript: ">=5" },
      optionalDependencies: { fsevents: "^2.0.0" }
    });
  });

  it("rejects an empty package.json", async () => {
    const fixture = await createFixture();
    await fs.writeFile(packageJsonPath(fixture), "  \n", "utf8");

    await expectPackageJsonError(fixture, "empty", "is empty");
  });

  it("rejects truncated or malformed JSON and preserves the parse cause", async () => {
    const fixture = await createFixture();
    await fs.writeFile(packageJsonPath(fixture), '{"scripts": {', "utf8");

    const error = await capturePackageJsonError(fixture);

    expect(error.kind).toBe("malformed");
    expect(error.message).toContain("contains malformed JSON");
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    ["null", "null"],
    ["[]", "an array"],
    ['"package"', "string"],
    ["42", "number"]
  ])("rejects invalid JSON root %s", async (raw, description) => {
    const fixture = await createFixture();
    await fs.writeFile(packageJsonPath(fixture), raw, "utf8");

    await expectPackageJsonError(fixture, "invalid-root", description);
  });

  it("rejects a numeric name", async () => {
    const fixture = await createFixture();
    await writePackageJson(fixture, { name: 42 });

    await expectPackageJsonError(fixture, "invalid-field", 'field "name"');
  });

  it.each(["description", "packageManager"])(
    "rejects non-string %s",
    async (field) => {
      const fixture = await createFixture();
      await writePackageJson(fixture, { [field]: 42 });

      await expectPackageJsonError(
        fixture,
        "invalid-field",
        `field "${field}"`
      );
    }
  );

  it("rejects scripts as an array", async () => {
    const fixture = await createFixture();
    await writePackageJson(fixture, { scripts: [] });

    await expectPackageJsonError(fixture, "invalid-field", 'field "scripts"');
  });

  it("rejects a script whose value is not a string", async () => {
    const fixture = await createFixture();
    await writePackageJson(fixture, { scripts: { test: false } });

    await expectPackageJsonError(
      fixture,
      "invalid-field",
      'field "scripts.test"'
    );
  });

  it("rejects a dependency group as an array", async () => {
    const fixture = await createFixture();
    await writePackageJson(fixture, { dependencies: [] });

    await expectPackageJsonError(
      fixture,
      "invalid-field",
      'field "dependencies"'
    );
  });

  it("rejects a dependency whose value is not a string", async () => {
    const fixture = await createFixture();
    await writePackageJson(fixture, { dependencies: { react: 19 } });

    await expectPackageJsonError(
      fixture,
      "invalid-field",
      'field "dependencies.react"'
    );
  });

  it("preserves dependency names that overlap object prototype keys", async () => {
    const fixture = await createFixture();
    await fs.writeFile(
      packageJsonPath(fixture),
      '{"dependencies":{"__proto__":"1.0.0"}}',
      "utf8"
    );

    const result = await readPackageJson(fixture);

    expect(Object.hasOwn(result?.dependencies ?? {}, "__proto__")).toBe(true);
    expect(result?.dependencies?.["__proto__"]).toBe("1.0.0");
  });

  it("wraps inaccessible file errors and preserves the filesystem cause", async () => {
    const fixture = await createFixture();
    const cause = Object.assign(new Error("permission denied"), {
      code: "EACCES"
    });
    vi.spyOn(fs, "readFile").mockRejectedValueOnce(cause);

    const error = await capturePackageJsonError(fixture);

    expect(error.kind).toBe("unreadable");
    expect(error.message).toContain("EACCES");
    expect(error.message).toContain(packageJsonPath(fixture));
    expect(error.cause).toBe(cause);
  });
});

async function expectPackageJsonError(
  fixture: string,
  kind: PackageJsonErrorKind,
  message: string
): Promise<void> {
  const error = await capturePackageJsonError(fixture);

  expect(error.kind).toBe(kind);
  expect(error.message).toContain(packageJsonPath(fixture));
  expect(error.message).toContain(message);
}

async function capturePackageJsonError(
  fixture: string
): Promise<PackageJsonError> {
  try {
    await readPackageJson(fixture);
  } catch (error) {
    expect(error).toBeInstanceOf(PackageJsonError);
    return error as PackageJsonError;
  }

  throw new Error("Expected readPackageJson to reject");
}

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adao-package-"));
  tempDirs.push(directory);
  return directory;
}

async function writePackageJson(
  fixture: string,
  value: unknown
): Promise<void> {
  await fs.writeFile(
    packageJsonPath(fixture),
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

function packageJsonPath(fixture: string): string {
  return path.join(fixture, "package.json");
}
