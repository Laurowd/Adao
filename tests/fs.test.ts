import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listProjectPathsRecursive } from "../src/utils/fs.js";

const tempDirs: string[] = [];

describe("listProjectPathsRecursive", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("reports a complete project below the entry limit", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "package.json"), "{}", "utf8");
    await fs.mkdir(path.join(fixture, "src"));
    await fs.writeFile(path.join(fixture, "src", "index.ts"), "", "utf8");

    const result = await listProjectPathsRecursive(fixture, 10);

    expect(result.entriesScanned).toBe(3);
    expect(result.entryLimit).toBe(10);
    expect(result.truncated).toBe(false);
    expect(result.unreadablePaths).toEqual([]);
  });

  it("marks the result as truncated when more entries remain at the limit", async () => {
    const fixture = await createFixture();
    await fs.mkdir(path.join(fixture, "large"));
    await fs.writeFile(path.join(fixture, "large", "one.ts"), "", "utf8");
    await fs.writeFile(path.join(fixture, "large", "two.ts"), "", "utf8");

    const result = await listProjectPathsRecursive(fixture, 1);

    expect(result.entriesScanned).toBe(1);
    expect(result.entryLimit).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.directories).toContain("large/");
  });

  it("records permission errors instead of discarding them", async () => {
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

    const result = await listProjectPathsRecursive(fixture, 10);

    expect(result.truncated).toBe(false);
    expect(result.unreadablePaths).toEqual([
      {
        path: "blocked/",
        code: "EACCES",
        category: "permission",
        blocking: true
      }
    ]);
  });

  it("records transient ENOENT without treating it as blocking", async () => {
    const fixture = await createFixture();
    const vanishedPath = path.join(fixture, "vanished");
    await fs.mkdir(vanishedPath);
    const originalReaddir = fs.readdir.bind(fs);

    vi.spyOn(fs, "readdir").mockImplementation(async (directoryPath, options) => {
      if (path.resolve(String(directoryPath)) === vanishedPath) {
        throw Object.assign(new Error("path disappeared"), { code: "ENOENT" });
      }

      return originalReaddir(directoryPath, options);
    });

    const result = await listProjectPathsRecursive(fixture, 10);

    expect(result.truncated).toBe(false);
    expect(result.unreadablePaths).toEqual([
      {
        path: "vanished/",
        code: "ENOENT",
        category: "transient",
        blocking: false
      }
    ]);
  });
});

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adao-fs-"));
  tempDirs.push(directory);
  return directory;
}
