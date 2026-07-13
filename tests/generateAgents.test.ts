import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateAgentsContent } from "../src/core/generateAgents.js";
import { scanProject } from "../src/core/scanProject.js";

const tempDirs: string[] = [];

describe("generateAgentsContent", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("generates short AGENTS.md content using detected package manager and scripts", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "pnpm-lock.yaml"), "", "utf8");
    await writeJson(path.join(fixture, "package.json"), {
      name: "demo",
      scripts: {
        dev: "vite",
        build: "vite build",
        test: "vitest run"
      },
      devDependencies: {
        vite: "^6.0.0",
        vitest: "^2.0.0",
        typescript: "^5.0.0"
      }
    });
    await fs.mkdir(path.join(fixture, "src"));
    await fs.writeFile(path.join(fixture, "src", "index.ts"), "", "utf8");

    const scan = await scanProject(fixture);
    const content = generateAgentsContent(scan);

    expect(content.startsWith("<!-- adao:start -->\n")).toBe(true);
    expect(content.endsWith("<!-- adao:end -->\n")).toBe(true);
    expect(content).toContain("# AGENTS.md");
    expect(content).toContain("Package manager: pnpm");
    expect(content).toContain("`pnpm dev`: Start development server");
    expect(content).toContain("`pnpm build`: Build project");
    expect(content).toContain("`pnpm test`: Run tests");
    expect(content).toContain("## Validation");
    expect(content).toContain("- `pnpm test`");
    expect(content).toContain("- `pnpm build`");
    expect(content).not.toContain("npm run dev");
    expect(content).toContain("`src/`: Main source code");
    expect(content).toContain(
      "Do not change package manager unless explicitly requested."
    );
  });

  it("uses a TODO overview when no reliable source describes the project", async () => {
    const fixture = await createFixture();
    await fs.mkdir(path.join(fixture, "src"));
    await fs.writeFile(path.join(fixture, "src", "index.ts"), "", "utf8");

    const scan = await scanProject(fixture);
    const content = generateAgentsContent(scan);

    expect(content).toContain("TODO: describe the project goal.");
    expect(content).not.toContain("This appears to be");
    expect(content).toContain("TODO: document common commands.");
  });

  it("uses README heading as overview when package.json has no description", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      name: "demo"
    });
    await fs.writeFile(
      path.join(fixture, "README.md"),
      "# Payments API\n\nHandles billing workflows.",
      "utf8"
    );

    const scan = await scanProject(fixture);
    const content = generateAgentsContent(scan);

    expect(scan.projectOverviewSource).toBe("README.md");
    expect(content).toContain("Payments API");
    expect(content).not.toContain("TODO: describe the project goal.");
  });

  it("uses the first useful README paragraph when it appears before a heading", async () => {
    const fixture = await createFixture();
    await fs.writeFile(
      path.join(fixture, "README.md"),
      "A practical workflow tracker for finance teams.\n\n## Install\n\nRun npm install.",
      "utf8"
    );

    const scan = await scanProject(fixture);
    const content = generateAgentsContent(scan);

    expect(scan.projectOverviewSource).toBe("README.md");
    expect(content).toContain(
      "A practical workflow tracker for finance teams."
    );
    expect(content).not.toContain("Install");
  });

  it("uses package description before README content", async () => {
    const fixture = await createFixture();
    await writeJson(path.join(fixture, "package.json"), {
      description: "Package description wins."
    });
    await fs.writeFile(
      path.join(fixture, "README.md"),
      "# README heading should not win",
      "utf8"
    );

    const scan = await scanProject(fixture);
    const content = generateAgentsContent(scan);

    expect(scan.projectOverviewSource).toBe("package.json");
    expect(content).toContain("Package description wins.");
    expect(content).not.toContain("README heading should not win");
  });

  it("orders known scripts before other scripts and adds validation commands", async () => {
    const fixture = await createFixture();
    await fs.writeFile(path.join(fixture, "package-lock.json"), "", "utf8");
    await writeJson(path.join(fixture, "package.json"), {
      scripts: {
        seed: "node seed.js",
        start: "node dist/index.js",
        typecheck: "tsc --noEmit",
        format: "prettier --write .",
        lint: "eslint .",
        test: "vitest run",
        build: "tsc",
        dev: "tsx src/index.ts"
      }
    });

    const scan = await scanProject(fixture);
    const content = generateAgentsContent(scan);

    expect(content.indexOf("`npm run dev`")).toBeLessThan(
      content.indexOf("`npm run build`")
    );
    expect(content.indexOf("`npm run build`")).toBeLessThan(
      content.indexOf("`npm run test`")
    );
    expect(content.indexOf("`npm run typecheck`")).toBeLessThan(
      content.indexOf("`npm run start`")
    );
    expect(content.indexOf("`npm run start`")).toBeLessThan(
      content.indexOf("`npm run seed`")
    );
    expect(content).toContain("Before finishing code changes");
    expect(content).toContain("- `npm run test`");
    expect(content).toContain("- `npm run build`");
    expect(content).toContain("- `npm run lint`");
    expect(content).toContain("- `npm run typecheck`");
  });
});

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adao-generate-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
