import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const tempDirs: string[] = [];

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

describe("cli", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("doctor --json returns structured JSON", async () => {
    const fixture = await createFixture();
    const result = await runCli(["doctor", fixture, "--json"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout) as {
      issues: unknown[];
      summary: { errors: number; warnings: number; infos: number };
      status: string;
    };

    expect(parsed.issues).toHaveLength(1);
    expect(parsed.summary).toEqual({ errors: 0, warnings: 1, infos: 0 });
    expect(parsed.status).toBe("needs attention");
  });

  it("doctor exits with code 1 when validation finds an error", async () => {
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

    const result = await runCli(["doctor", fixture]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Status: broken");
    expect(result.stdout).toContain("Summary: 1 error");
  });

  it("apply --yes creates AGENTS.md when it does not exist", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      description: "A fixture project."
    });

    const result = await runCli(["apply", fixture, "--yes"]);
    const agentsContent = await fs.readFile(
      path.join(fixture, "AGENTS.md"),
      "utf8"
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--yes supplied");
    expect(agentsContent).toContain("A fixture project.");
  });

  it("apply does not create a backup when AGENTS.md did not exist", async () => {
    const fixture = await createFixture();

    await runCli(["apply", fixture, "--yes"]);

    await expect(
      fs.access(path.join(fixture, "AGENTS.md.bak"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("apply creates a backup when overwriting AGENTS.md", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    await writeJson(path.join(fixture, "package.json"), {
      description: "Updated instructions."
    });
    await fs.writeFile(agentsPath, "old instructions\n", "utf8");

    const result = await runCli(["apply", fixture, "--yes"]);
    const backupContent = await fs.readFile(`${agentsPath}.bak`, "utf8");
    const newContent = await fs.readFile(agentsPath, "utf8");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Backup written");
    expect(backupContent).toBe("old instructions\n");
    expect(newContent).toContain("Updated instructions.");
  });
});

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adao-cli-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function runCli(args: string[]): Promise<CliResult> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const stdout: string[] = [];
  const stderr: string[] = [];

  console.log = (...values: unknown[]) => {
    stdout.push(values.map(String).join(" "));
  };
  console.error = (...values: unknown[]) => {
    stderr.push(values.map(String).join(" "));
  };
  process.exitCode = undefined;

  try {
    await main(args);

    return {
      code: typeof process.exitCode === "number" ? process.exitCode : 0,
      stdout: stdout.length > 0 ? `${stdout.join("\n")}\n` : "",
      stderr: stderr.length > 0 ? `${stderr.join("\n")}\n` : ""
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}
