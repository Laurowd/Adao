import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateAgents } from "../src/core/validateAgents.js";

const tempDirs: string[] = [];

describe("validateAgents", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("reports an error when AGENTS.md mentions a missing package script", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      scripts: {
        test: "vitest run"
      }
    });
    await fs.writeFile(
      path.join(fixture, "AGENTS.md"),
      "Run npm run build before finishing.",
      "utf8"
    );

    const result = await validateAgents(fixture, {
      globalAgentsPath: path.join(fixture, "missing-global.md")
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "command-script-missing"
      })
    );
  });

  it("warns when AGENTS.md is larger than 4000 characters", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "AGENTS.md"), "a".repeat(4001), "utf8");

    const result = await validateAgents(fixture, {
      globalAgentsPath: path.join(fixture, "missing-global.md")
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "agents-large"
      })
    );
  });

  it("warns when AGENTS.md contains vague guidance", async () => {
    const fixture = await createFixture();
    await fs.writeFile(
      path.join(fixture, "AGENTS.md"),
      "Please write clean code and follow best practices.",
      "utf8"
    );

    const result = await validateAgents(fixture, {
      globalAgentsPath: path.join(fixture, "missing-global.md")
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "vague-language"
        })
      ])
    );
  });

  it("calculates healthy summary and status when no issues are found", async () => {
    const fixture = await createFixture();
    await fs.writeFile(
      path.join(fixture, "AGENTS.md"),
      "Use the existing project conventions.",
      "utf8"
    );

    const result = await validateAgents(fixture, {
      globalAgentsPath: path.join(fixture, "missing-global.md")
    });

    expect(result.summary).toEqual({ errors: 0, warnings: 0, infos: 0 });
    expect(result.status).toBe("healthy");
  });

  it("calculates needs attention status when warnings are found", async () => {
    const fixture = await createFixture();

    const result = await validateAgents(fixture, {
      globalAgentsPath: path.join(fixture, "missing-global.md")
    });

    expect(result.summary).toEqual({ errors: 0, warnings: 1, infos: 0 });
    expect(result.status).toBe("needs attention");
  });

  it("calculates broken status when errors are found", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      scripts: {
        test: "vitest run"
      }
    });
    await fs.writeFile(
      path.join(fixture, "AGENTS.md"),
      "Run npm run build before finishing.",
      "utf8"
    );

    const result = await validateAgents(fixture, {
      globalAgentsPath: path.join(fixture, "missing-global.md")
    });

    expect(result.summary.errors).toBe(1);
    expect(result.status).toBe("broken");
  });
});

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adao-validate-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
