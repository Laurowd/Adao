import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import type { ScanProjectOptions } from "../src/core/scanProject.js";

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

  it.each(["--help", "-h"])("prints global help for %s", async (flag) => {
    const result = await runCli([flag]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("adao scan <projectPath> [--json]");
    expect(result.stdout).toContain("adao doctor <projectPath> [--json]");
    expect(result.stdout).toContain("adao generate <projectPath>");
    expect(result.stdout).toContain("adao suggest <projectPath> [--json]");
    expect(result.stdout).toContain("adao apply <projectPath> [--yes]");
  });

  it.each([
    ["scan", "--json"],
    ["doctor", "--json"],
    ["generate", undefined],
    ["suggest", "--json"],
    ["apply", "--yes"]
  ] as const)("prints filesystem-free help for %s", async (command, flag) => {
    const result = await runCli([command, "--help"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain(`Usage: adao ${command} <projectPath>`);
    expect(result.stdout).toContain("Example:");
    if (flag) {
      expect(result.stdout).toContain(flag);
    }
  });

  it.each(["--version", "-V"])("prints package version for %s", async (flag) => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "package.json"), "utf8")
    ) as { version: string };
    const result = await runCli([flag]);

    expect(result).toEqual({
      code: 0,
      stdout: `${packageJson.version}\n`,
      stderr: ""
    });
  });

  it("reports an unknown command as a textual usage error", async () => {
    const result = await runCli(["scna", "."]);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage error: Unknown command 'scna'");
  });

  it.each([
    [["scan"], "Missing projectPath"],
    [["scan", "one", "two"], "exactly one projectPath"],
    [["scan", ".", "--josn"], "Unknown flag '--josn'"],
    [["scan", ".", "--json", "--json"], "Duplicate flag '--json'"],
    [["generate", ".", "--json"], "Unknown flag '--json'"],
    [["doctor", ".", "--yes"], "Unknown flag '--yes'"]
  ] as const)("rejects invalid usage without stdout: %j", async (args, message) => {
    const result = await runCli([...args]);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });

  it("returns a JSON usage error when valid --json mode was recognized", async () => {
    const result = await runCli(["scan", "--json", ".", "extra"]);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        type: "usage",
        message: "Command 'scan' accepts exactly one projectPath; received 2."
      }
    });
  });

  it("does not treat misspelled --josn as JSON mode", async () => {
    const result = await runCli(["scan", ".", "--josn"]);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage error:");
    expect(() => JSON.parse(result.stderr)).toThrow();
  });

  it("returns textual operational errors only on stderr", async () => {
    const missing = path.join(os.tmpdir(), `adao-missing-${Date.now()}`);
    const result = await runCli(["scan", missing]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Error:");
  });

  it("returns operational errors as JSON only on stderr in JSON mode", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "package.json"), "{", "utf8");
    const result = await runCli(["scan", "--json", fixture]);
    const parsed = JSON.parse(result.stderr) as {
      error: { type: string; message: string };
    };

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(parsed.error.type).toBe("operational");
    expect(parsed.error.message).toContain("package.json");
  });

  it.each([
    ["missing path", ["apply"]],
    ["two paths", ["apply", "one", "two"]],
    ["unknown flag", ["apply", ".", "--force"]],
    ["duplicate --yes", ["apply", ".", "--yes", "--yes"]],
    ["unsupported --json", ["apply", ".", "--json"]],
    ["unknown command", ["aply", "."]]
  ] as const)("invalid apply-like input (%s) performs no writes", async (_name, args) => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "manual content\n";
    await fs.writeFile(agentsPath, previous, "utf8");
    let confirmationRequested = false;
    const concreteArgs = args.map((arg) => (arg === "." ? fixture : arg));

    const result = await runCli(concreteArgs, async () => {
      confirmationRequested = true;
      return true;
    });

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(confirmationRequested).toBe(false);
    expect(await fs.readFile(agentsPath, "utf8")).toBe(previous);
    expect(
      (await fs.readdir(fixture)).some(
        (file) => file.includes(".bak") || file.includes("adao.tmp")
      )
    ).toBe(false);
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

  it.each(["scan", "doctor", "generate", "suggest"])(
    "%s rejects malformed package.json with an actionable message",
    async (command) => {
      const fixture = await createFixture();
      const packageJsonPath = path.join(fixture, "package.json");
      await fs.writeFile(packageJsonPath, '{"scripts": {', "utf8");

      const result = await runCli([command, fixture]);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        `package.json at ${packageJsonPath} contains malformed JSON`
      );
    }
  );

  it("scan exposes package manager conflicts in text and JSON", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "package-lock.json"), "", "utf8");
    await writeJson(path.join(fixture, "package.json"), {
      packageManager: "pnpm@9.1.0"
    });

    const textResult = await runCli(["scan", fixture]);
    const jsonResult = await runCli(["scan", fixture, "--json"]);
    const parsed = JSON.parse(jsonResult.stdout) as {
      packageManager: null;
      packageManagerEvidence: { conflict: boolean };
    };

    expect(textResult.stdout).toContain(
      "Package manager: conflict (lockfile: npm, package.json: pnpm@9.1.0)"
    );
    expect(parsed.packageManager).toBeNull();
    expect(parsed.packageManagerEvidence.conflict).toBe(true);
    const generateResult = await runCli(["generate", fixture]);
    expect(generateResult.code).toBe(1);
    expect(generateResult.stderr).toContain("package manager conflict");
  });

  it("generate rejects an unrecognized packageManager without lockfile evidence", async () => {
    const fixture = await createFixture();
    const packageJsonPath = path.join(fixture, "package.json");
    await writeJson(packageJsonPath, {
      packageManager: "unknown@1.0.0",
      scripts: { test: "vitest run" }
    });

    const result = await runCli(["generate", fixture]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      `package.json at ${packageJsonPath} declares unrecognized packageManager value`
    );
  });

  it("apply rejects malformed package.json before confirmation or writes", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "manual instructions\n";
    await fs.writeFile(agentsPath, previous, "utf8");
    await fs.writeFile(path.join(fixture, "package.json"), "{", "utf8");
    let confirmationRequested = false;

    const result = await runCli(["apply", fixture], async () => {
      confirmationRequested = true;
      return true;
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("package.json");
    expect(confirmationRequested).toBe(false);
    expect(await fs.readFile(agentsPath, "utf8")).toBe(previous);
    expect(
      (await fs.readdir(fixture)).some(
        (file) => file.includes(".bak") || file.includes("adao.tmp")
      )
    ).toBe(false);
  });

  it("apply rejects package manager conflicts before confirmation or writes", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "manual instructions\n";
    await fs.writeFile(agentsPath, previous, "utf8");
    await fs.writeFile(path.join(fixture, "package-lock.json"), "", "utf8");
    await writeJson(path.join(fixture, "package.json"), {
      packageManager: "pnpm@9.1.0"
    });
    let confirmationRequested = false;

    const result = await runCli(["apply", fixture], async () => {
      confirmationRequested = true;
      return true;
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("package manager conflict");
    expect(confirmationRequested).toBe(false);
    expect(await fs.readFile(agentsPath, "utf8")).toBe(previous);
    expect(
      (await fs.readdir(fixture)).some(
        (file) => file.includes(".bak") || file.includes("adao.tmp")
      )
    ).toBe(false);
  });

  it("scan text and JSON expose incomplete scan metadata", async () => {
    const fixture = await createTruncatedFixture();
    const scanOptions = { entryLimit: 1 };

    const textResult = await runCli(["scan", fixture], undefined, scanOptions);
    const jsonResult = await runCli(
      ["scan", fixture, "--json"],
      undefined,
      scanOptions
    );
    const parsed = JSON.parse(jsonResult.stdout) as {
      scanMetadata: {
        entriesScanned: number;
        entryLimit: number;
        truncated: boolean;
        complete: boolean;
      };
    };

    expect(textResult.stdout).toContain("Scan completeness: incomplete");
    expect(textResult.stdout).toContain("Entries scanned: 1 (limit: 1)");
    expect(textResult.stdout).toContain("WARNING: Scan results are partial");
    expect(parsed.scanMetadata).toMatchObject({
      entriesScanned: 1,
      entryLimit: 1,
      truncated: true,
      complete: false
    });
  });

  it("doctor reports broken when the project scan is incomplete", async () => {
    const fixture = await createTruncatedFixture();
    await fs.writeFile(
      path.join(fixture, "AGENTS.md"),
      "Use existing conventions.\n",
      "utf8"
    );

    const result = await runCli(
      ["doctor", fixture],
      undefined,
      { entryLimit: 2 }
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("scan is incomplete");
    expect(result.stdout).toContain("Status: broken");
    expect(result.stdout).not.toContain("No AGENTS.md issues found.");
  });

  it("generate is blocked when the project scan is incomplete", async () => {
    const fixture = await createTruncatedFixture();

    const result = await runCli(
      ["generate", fixture],
      undefined,
      { entryLimit: 1 }
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "Cannot generate AGENTS.md: project scan is incomplete"
    );
  });

  it("apply aborts an incomplete scan before confirmation or filesystem writes", async () => {
    const fixture = await createTruncatedFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "manual instructions must remain\n";
    await fs.writeFile(agentsPath, previous, "utf8");
    let confirmationRequested = false;

    const result = await runCli(
      ["apply", fixture],
      async () => {
        confirmationRequested = true;
        return true;
      },
      { entryLimit: 2 }
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "Cannot apply AGENTS.md: project scan is incomplete"
    );
    expect(confirmationRequested).toBe(false);
    expect(await fs.readFile(agentsPath, "utf8")).toBe(previous);
    expect(await fs.readdir(fixture)).toEqual(["AGENTS.md", "large"]);
    expect(
      (await fs.readdir(fixture)).some(
        (file) => file.includes(".bak") || file.includes("adao.tmp")
      )
    ).toBe(false);
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
    expect(agentsContent).toContain("<!-- adao:start -->");
    expect(agentsContent).toContain("<!-- adao:end -->");
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
    expect(result.stdout).toContain("Legacy AGENTS.md has no Adão markers");
    expect(result.stdout).toContain("manual content will not be preserved");
    expect(result.stdout).toContain("Backup written");
    expect(backupContent).toBe("old instructions\n");
    expect(newContent).toContain("Updated instructions.");
  });

  it("apply aborts before writing when confirmation is declined", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "manual legacy instructions\n";
    await fs.writeFile(agentsPath, previous, "utf8");

    const result = await runCli(["apply", fixture], async () => false);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Aborted.");
    expect(await fs.readFile(agentsPath, "utf8")).toBe(previous);
    await expect(fs.access(`${agentsPath}.bak`)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("apply aborts when AGENTS.md changes while awaiting confirmation", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "manual legacy instructions\n";
    const concurrent = "changed while preview was visible\n";
    await fs.writeFile(agentsPath, previous, "utf8");

    const result = await runCli(["apply", fixture], async () => {
      await fs.writeFile(agentsPath, concurrent, "utf8");
      return true;
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("changed after the preview");
    expect(await fs.readFile(agentsPath, "utf8")).toBe(concurrent);
    await expect(fs.access(`${agentsPath}.bak`)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("suggest --json returns structured JSON", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      description: "Suggest fixture."
    });

    const result = await runCli(["suggest", fixture, "--json"]);
    const parsed = JSON.parse(result.stdout) as {
      scan: unknown;
      validation: unknown;
      generatedAgents: string;
      evidenceFiles: unknown[];
      prompt: string;
    };

    expect(result.code).toBe(0);
    expect(parsed.scan).toEqual(expect.any(Object));
    expect(parsed.validation).toEqual(expect.any(Object));
    expect(parsed.generatedAgents).toContain("Suggest fixture.");
    expect(parsed.evidenceFiles).toEqual(expect.any(Array));
    expect(parsed.prompt).toContain("## Current generated AGENTS.md");
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

async function createTruncatedFixture(): Promise<string> {
  const fixture = await createFixture();
  await fs.mkdir(path.join(fixture, "large"));
  await fs.writeFile(path.join(fixture, "large", "one.ts"), "", "utf8");
  return fixture;
}

async function runCli(
  args: string[],
  confirmAction?: (question: string) => Promise<boolean>,
  scanOptions?: ScanProjectOptions
): Promise<CliResult> {
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
    await main(args, confirmAction, scanOptions);

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
