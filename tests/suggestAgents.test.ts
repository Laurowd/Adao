import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSuggestResult } from "../src/core/suggestAgents.js";

const tempDirs: string[] = [];

describe("createSuggestResult", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("generates a prompt containing the generated AGENTS.md", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      description: "A local context doctor.",
      scripts: {
        test: "vitest run"
      }
    });

    const result = await createSuggestResult(fixture);

    expect(result.generatedAgents).toContain("A local context doctor.");
    expect(result.prompt).toContain("## Current generated AGENTS.md");
    expect(result.prompt).toContain(result.generatedAgents);
  });

  it("includes README.md and package.json when they exist", async () => {
    const fixture = await createFixture();
    await fs.writeFile(
      path.join(fixture, "README.md"),
      "# Demo\n\nUseful context.",
      "utf8"
    );
    await writeJson(path.join(fixture, "package.json"), {
      name: "demo"
    });

    const result = await createSuggestResult(fixture);

    expect(result.evidenceFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(["README.md", "package.json"])
    );
  });

  it("keeps evidence blocks valid when files contain Markdown fences", async () => {
    const fixture = await createFixture();
    await fs.writeFile(
      path.join(fixture, "README.md"),
      "# Demo\n\n```bash\nnpm test\n```",
      "utf8"
    );

    const result = await createSuggestResult(fixture);

    expect(result.prompt).toContain("````text");
    expect(result.prompt).toContain("```bash");
  });

  it("limits large files and marks them as truncated", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "README.md"), "a".repeat(12_500), "utf8");

    const result = await createSuggestResult(fixture);
    const readme = result.evidenceFiles.find((file) => file.path === "README.md");

    expect(readme).toBeDefined();
    expect(readme?.content).toHaveLength(12_000);
    expect(readme?.truncated).toBe(true);
    expect(result.prompt).toContain("[truncated]");
  });

  it("does not call an external API", async () => {
    const fixture = await createFixture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    try {
      await expect(createSuggestResult(fixture)).resolves.toMatchObject({
        scan: expect.any(Object),
        prompt: expect.any(String)
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("includes the current doctor validation result", async () => {
    const fixture = await createFixture();

    const result = await createSuggestResult(fixture);

    expect(result.validation.summary).toEqual({
      errors: 0,
      warnings: 1,
      infos: 0
    });
    expect(result.validation.status).toBe("needs attention");
    expect(result.prompt).toContain("## Current doctor result");
    expect(result.prompt).toContain("agents-missing");
  });

  it("refuses to build a prompt from a truncated scan", async () => {
    const fixture = await createFixture();
    await fs.mkdir(path.join(fixture, "large"));
    await fs.writeFile(path.join(fixture, "large", "one.ts"), "", "utf8");

    await expect(
      createSuggestResult(fixture, { entryLimit: 1 })
    ).rejects.toThrow("Cannot create suggestion: project scan is incomplete");
  });
});

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adao-suggest-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
