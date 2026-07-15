import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanProject } from "../src/core/scanProject.js";
import type { PackageManager } from "../src/core/types.js";

const tempDirs: string[] = [];

describe("scanProject", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
      )
    );
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"]
  ] satisfies Array<[string, Exclude<PackageManager, null>]>)(
    "detects %s as %s",
    async (lockfile, expectedPackageManager) => {
      const fixture = await createFixture();
      await fs.writeFile(path.join(fixture, lockfile), "", "utf8");

      const scan = await scanProject(fixture);

      expect(scan.packageManager).toBe(expectedPackageManager);
    }
  );

  it("detects package scripts and stack from package.json", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      name: "demo-project",
      scripts: {
        dev: "vite",
        build: "vite build",
        test: "vitest run",
        typecheck: "tsc --noEmit"
      },
      dependencies: {
        react: "^19.0.0",
        vite: "^6.0.0"
      },
      devDependencies: {
        vitest: "^2.0.0",
        typescript: "^5.0.0"
      }
    });
    await fs.mkdir(path.join(fixture, "src"));
    await fs.writeFile(path.join(fixture, "src", "index.ts"), "", "utf8");

    const scan = await scanProject(fixture);

    expect(scan.projectName).toBe("demo-project");
    expect(scan.scripts).toMatchObject({
      dev: "vite",
      build: "vite build",
      test: "vitest run",
      typecheck: "tsc --noEmit"
    });
    expect(scan.languages).toContain("TypeScript");
    expect(scan.frameworks).toEqual(
      expect.arrayContaining(["React", "Vite", "Vitest"])
    );
    expect(scan.scanMetadata).toMatchObject({
      entryLimit: 5000,
      truncated: false,
      unreadablePaths: [],
      complete: true
    });
  });

  it("exposes Fastify, PostgreSQL, and Cypress from the root package.json", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      dependencies: {
        fastify: "^5.0.0",
        postgres: "^3.0.0"
      },
      devDependencies: {
        cypress: "^15.0.0"
      }
    });

    const scan = await scanProject(fixture);

    expect(scan.frameworks).toEqual(["Fastify", "PostgreSQL", "Cypress"]);
  });

  it("does not aggregate dependencies from a nested package.json", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      dependencies: { fastify: "^5.0.0" }
    });
    await fs.mkdir(path.join(fixture, "web"));
    await writeJson(path.join(fixture, "web", "package.json"), {
      dependencies: { vue: "^3.0.0" },
      devDependencies: { vite: "^6.0.0" }
    });

    const scan = await scanProject(fixture);

    expect(scan.frameworks).toEqual(["Fastify"]);
    expect(scan.frameworks).not.toContain("Vite");
  });

  it("uses a recognized packageManager value when no lockfile exists", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      packageManager: "pnpm@9.1.0"
    });

    const scan = await scanProject(fixture);

    expect(scan.packageManager).toBe("pnpm");
    expect(scan.packageManagerEvidence).toEqual({
      lockfile: null,
      packageJson: "pnpm",
      packageJsonValue: "pnpm@9.1.0",
      conflict: false
    });
  });

  it("uses matching packageManager and lockfile evidence", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "yarn.lock"), "", "utf8");
    await writeJson(path.join(fixture, "package.json"), {
      packageManager: "yarn@4.5.0"
    });

    const scan = await scanProject(fixture);

    expect(scan.packageManager).toBe("yarn");
    expect(scan.packageManagerEvidence).toMatchObject({
      lockfile: "yarn",
      packageJson: "yarn",
      conflict: false
    });
  });

  it("records an unrecognized packageManager without selecting it", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      packageManager: "unknown@1.0.0"
    });

    const scan = await scanProject(fixture);

    expect(scan.packageManager).toBeNull();
    expect(scan.packageManagerEvidence).toEqual({
      lockfile: null,
      packageJson: null,
      packageJsonValue: "unknown@1.0.0",
      conflict: false
    });
  });

  it("represents a conflict between packageManager and lockfile", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "package-lock.json"), "", "utf8");
    await writeJson(path.join(fixture, "package.json"), {
      packageManager: "pnpm@9.1.0"
    });

    const scan = await scanProject(fixture);

    expect(scan.packageManager).toBeNull();
    expect(scan.packageManagerEvidence).toEqual({
      lockfile: "npm",
      packageJson: "pnpm",
      packageJsonValue: "pnpm@9.1.0",
      conflict: true
    });
  });

  it("detects important root files before a large directory reaches the limit", async () => {
    const fixture = await createFixture();
    await fs.mkdir(path.join(fixture, "large"));
    await fs.writeFile(path.join(fixture, "large", "one.ts"), "", "utf8");
    await fs.writeFile(path.join(fixture, "large", "two.ts"), "", "utf8");
    await writeJson(path.join(fixture, "package.json"), { name: "root-first" });
    await fs.writeFile(path.join(fixture, "package-lock.json"), "", "utf8");
    await fs.writeFile(path.join(fixture, "tsconfig.json"), "{}", "utf8");

    const scan = await scanProject(fixture, { entryLimit: 4 });

    expect(scan.scanMetadata).toMatchObject({
      entriesScanned: 4,
      entryLimit: 4,
      truncated: true,
      complete: false
    });
    expect(scan.projectName).toBe("root-first");
    expect(scan.packageManager).toBe("npm");
    expect(scan.importantFiles).toEqual(
      expect.arrayContaining(["package.json", "tsconfig.json"])
    );
  });

  it("marks the scan incomplete when a directory cannot be read", async () => {
    const fixture = await createFixture();
    const blockedPath = path.join(fixture, "blocked");
    await fs.mkdir(blockedPath);
    const originalReaddir = fs.readdir.bind(fs);

    vi.spyOn(fs, "readdir").mockImplementation(async (directoryPath, options) => {
      if (path.resolve(String(directoryPath)) === blockedPath) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }

      return originalReaddir(directoryPath, options);
    });

    const scan = await scanProject(fixture);

    expect(scan.scanMetadata).toMatchObject({
      truncated: false,
      complete: false,
      unreadablePaths: [
        {
          path: "blocked/",
          code: "EACCES",
          category: "permission",
          blocking: true
        }
      ]
    });
  });

  it("detects additional important files and project structure directories", async () => {
    const fixture = await createFixture();
    await fs.mkdir(path.join(fixture, "src"));
    await fs.mkdir(path.join(fixture, "app"));
    await fs.mkdir(path.join(fixture, "pages"));
    await fs.mkdir(path.join(fixture, "components"));
    await fs.mkdir(path.join(fixture, "tests"));
    await fs.mkdir(path.join(fixture, "__tests__"));
    await fs.mkdir(path.join(fixture, "docs"));
    await fs.mkdir(path.join(fixture, ".github", "workflows"), {
      recursive: true
    });
    await fs.writeFile(path.join(fixture, "src", "index.ts"), "", "utf8");
    await fs.writeFile(path.join(fixture, "app", "page.tsx"), "", "utf8");
    await fs.writeFile(path.join(fixture, "pages", "index.tsx"), "", "utf8");
    await fs.writeFile(
      path.join(fixture, "components", "button.tsx"),
      "",
      "utf8"
    );
    await fs.writeFile(path.join(fixture, "tests", "app.test.ts"), "", "utf8");
    await fs.writeFile(
      path.join(fixture, "__tests__", "unit.test.ts"),
      "",
      "utf8"
    );
    await fs.writeFile(path.join(fixture, "docs", "usage.md"), "", "utf8");
    await fs.writeFile(
      path.join(fixture, ".github", "workflows", "ci.yml"),
      "",
      "utf8"
    );
    await fs.writeFile(path.join(fixture, "compose.yaml"), "", "utf8");
    await fs.writeFile(path.join(fixture, "docker-compose.yaml"), "", "utf8");

    const scan = await scanProject(fixture);

    expect(scan.projectStructure).toEqual(
      expect.arrayContaining([
        "src/",
        "app/",
        "pages/",
        "components/",
        "tests/",
        "__tests__/",
        "docs/",
        ".github/workflows/"
      ])
    );
    expect(scan.importantFiles).toEqual(
      expect.arrayContaining(["compose.yaml", "docker-compose.yaml"])
    );
  });
});

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adao-scan-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
