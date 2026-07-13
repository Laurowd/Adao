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

  it.each([
    "Do not run npm run deploy.",
    "Never use npm run build in this project.",
    "Avoid running pnpm seed."
  ])("ignores package commands in negative guidance: %s", async (content) => {
    const result = await validateFixture(content, { scripts: {} });

    expect(result.issues).toEqual([]);
  });

  it.each([
    "Example: npm run deploy might publish an application.",
    "For example, pnpm seed could populate a demonstration database."
  ])("ignores explicitly hypothetical command examples: %s", async (content) => {
    const result = await validateFixture(content, { scripts: {} });

    expect(result.issues).toEqual([]);
  });

  it.each([
    "Run `npm run missing` before finishing.",
    "```sh\nnpm run missing\n```"
  ])("validates real commands in Markdown: %s", async (content) => {
    const result = await validateFixture(content, { scripts: {} });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "command-script-missing"
      })
    );
  });

  it.each([
    "Run npm run test -- --watch.",
    "Run pnpm test --runInBand."
  ])("recognizes commands with trailing flags: %s", async (content) => {
    const manager = content.startsWith("Run pnpm") ? "pnpm" : "npm";
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      scripts: { test: "vitest run" },
      packageManager: `${manager}@1.0.0`
    });
    await fs.writeFile(path.join(fixture, "AGENTS.md"), content, "utf8");

    const result = await validateWithoutGlobal(fixture);

    expect(result.issues).toEqual([]);
  });

  it.each([
    ["npm", "Run npm run test before finishing."],
    ["pnpm", "Run pnpm test before finishing."],
    ["yarn", "Run yarn test before finishing."],
    ["bun", "Run bun run test before finishing."]
  ])("accepts commands using detected %s", async (manager, instruction) => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      scripts: { test: "vitest run" },
      packageManager: `${manager}@1.0.0`
    });
    await fs.writeFile(
      path.join(fixture, "AGENTS.md"),
      instruction,
      "utf8"
    );

    const result = await validateWithoutGlobal(fixture);

    expect(result.issues).toEqual([]);
  });

  it("reports one specific issue for a divergent package manager command", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      scripts: {}
    });
    await fs.writeFile(path.join(fixture, "pnpm-lock.yaml"), "", "utf8");
    await fs.writeFile(
      path.join(fixture, "AGENTS.md"),
      "Run npm run test before finishing.",
      "utf8"
    );

    const result = await validateWithoutGlobal(fixture);

    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "package-manager-command-conflict",
        message: expect.stringContaining("npm run test")
      })
    ]);
  });

  it("does not report a manager conflict without detected manager evidence", async () => {
    const result = await validateFixture("Run npm run test.", {
      scripts: { test: "vitest run" }
    });

    expect(result.issues).toEqual([]);
  });

  it("accepts npm start through the default root server.js behavior", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), { scripts: {} });
    await fs.writeFile(path.join(fixture, "server.js"), "", "utf8");
    await fs.writeFile(path.join(fixture, "AGENTS.md"), "Run npm start.", "utf8");

    const result = await validateWithoutGlobal(fixture);

    expect(result.issues).toEqual([]);
  });

  it.each([
    "Express intent clearly.",
    "React to errors carefully.",
    "Do not introduce React.",
    "Avoid Prisma in this project.",
    "Example: a React project might use Vite."
  ])("ignores ambiguous, negative, or hypothetical stack prose: %s", async (content) => {
    const result = await validateFixture(content);

    expect(result.issues).toEqual([]);
  });

  it.each([
    ["This project uses React.", "React"],
    ["Tech stack: Prisma and PostgreSQL.", "Prisma"],
    ["Framework: Next.js.", "Next.js"],
    ["The frontend is built with Vite.", "Vite"],
    ["Dependencies include Express.", "Express"]
  ])("warns for a real undetected stack declaration: %s", async (content, label) => {
    const result = await validateFixture(content);

    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "stack-not-detected",
        message: expect.stringContaining(label)
      })
    ]);
  });

  it("does not duplicate equivalent command issues", async () => {
    const result = await validateFixture(
      "- Run `npm run deploy`.\n- Run npm run deploy -- --dry-run.",
      { scripts: {} }
    );

    expect(
      result.issues.filter((issue) => issue.code === "command-script-missing")
    ).toHaveLength(1);
  });

  it("does not degrade freshness when only a lockfile has a newer mtime", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {});
    await fs.writeFile(
      path.join(fixture, "AGENTS.md"),
      "Use existing project conventions.",
      "utf8"
    );
    const lockfile = path.join(fixture, "package-lock.json");
    await fs.writeFile(lockfile, "{}", "utf8");
    const future = new Date(Date.now() + 5000);
    await fs.utimes(lockfile, future, future);

    const result = await validateWithoutGlobal(fixture);

    expect(result.issues).toEqual([]);
    expect(result.status).toBe("healthy");
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

async function validateFixture(
  content: string,
  packageJson?: Record<string, unknown>
) {
  const fixture = await createFixture();

  if (packageJson) {
    await writeJson(path.join(fixture, "package.json"), packageJson);
  }

  await fs.writeFile(path.join(fixture, "AGENTS.md"), content, "utf8");
  return validateWithoutGlobal(fixture);
}

function validateWithoutGlobal(fixture: string) {
  return validateAgents(fixture, {
    globalAgentsPath: path.join(fixture, "missing-global.md")
  });
}
