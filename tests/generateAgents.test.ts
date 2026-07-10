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

    expect(content).toContain("# AGENTS.md");
    expect(content).toContain("Package manager: pnpm");
    expect(content).toContain("`pnpm dev`: Start development server");
    expect(content).toContain("`pnpm build`: Build project");
    expect(content).toContain("`pnpm test`: Run tests");
    expect(content).not.toContain("npm run dev");
    expect(content).toContain("`src/`: Main source code");
    expect(content).toContain(
      "Do not change package manager unless explicitly requested."
    );
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
