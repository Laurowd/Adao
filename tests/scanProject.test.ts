import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "../src/core/scanProject.js";
import type { PackageManager } from "../src/core/types.js";

const tempDirs: string[] = [];

describe("scanProject", () => {
  afterEach(async () => {
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
