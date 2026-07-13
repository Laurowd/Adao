import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADAO_END_MARKER,
  ADAO_START_MARKER,
  commitAgentsUpdate,
  prepareAgentsUpdate,
  readAgentsContent,
  wrapManagedAgentsContent
} from "../src/core/applyAgents.js";

const tempDirs: string[] = [];

describe("applyAgents", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        fs.rm(directory, { recursive: true, force: true })
      )
    );
  });

  it("creates a marked AGENTS.md when it does not exist", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const generated = generatedContent("first version");
    const update = prepareAgentsUpdate(null, generated);

    const result = await commitAgentsUpdate(agentsPath, update);

    expect(result.backupPath).toBeNull();
    expect(await fs.readFile(agentsPath, "utf8")).toBe(generated);
  });

  it("updates only the content between markers", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = `manual before\n${generatedContent("old managed")}manual after\n`;
    await fs.writeFile(agentsPath, previous, "utf8");

    const update = prepareAgentsUpdate(
      previous,
      generatedContent("new managed")
    );
    await commitAgentsUpdate(agentsPath, update);

    expect(await fs.readFile(agentsPath, "utf8")).toBe(
      `manual before\n${generatedContent("new managed")}manual after\n`
    );
  });

  it("preserves content before the start marker byte for byte", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const prefix = "# Manual\r\n\r\nKeep  two spaces.\r\n";
    const previous = `${prefix}${generatedContent("old")}`;
    await fs.writeFile(agentsPath, previous, "utf8");

    const update = prepareAgentsUpdate(previous, generatedContent("new"));
    await commitAgentsUpdate(agentsPath, update);
    const updated = await fs.readFile(agentsPath, "utf8");

    expect(updated.slice(0, prefix.length)).toBe(prefix);
  });

  it("preserves content after the end marker byte for byte", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const suffix = "\r\nManual suffix\twith tab\r\n";
    const previous = `${generatedContent("old")}${suffix}`;
    await fs.writeFile(agentsPath, previous, "utf8");

    const update = prepareAgentsUpdate(previous, generatedContent("new"));
    await commitAgentsUpdate(agentsPath, update);
    const updated = await fs.readFile(agentsPath, "utf8");

    expect(updated.slice(-suffix.length)).toBe(suffix);
  });

  it("is idempotent and does not create another backup", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const content = `manual\n${generatedContent("current")}`;
    await fs.writeFile(agentsPath, content, "utf8");
    const update = prepareAgentsUpdate(content, generatedContent("current"));

    const result = await commitAgentsUpdate(agentsPath, update);

    expect(update.nextContent).toBe(content);
    expect(result.backupPath).toBeNull();
    expect(await fs.readdir(fixture)).toEqual(["AGENTS.md"]);
  });

  it("replaces a legacy file only after preparing a full backup", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "hand-written legacy instructions\n";
    const generated = generatedContent("managed replacement");
    await fs.writeFile(agentsPath, previous, "utf8");

    const update = prepareAgentsUpdate(previous, generated);
    const result = await commitAgentsUpdate(agentsPath, update);

    expect(update.kind).toBe("legacy");
    expect(await fs.readFile(agentsPath, "utf8")).toBe(generated);
    expect(await fs.readFile(result.backupPath!, "utf8")).toBe(previous);
  });

  it("uses the next predictable name when a backup already exists", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "legacy content\n";
    await fs.writeFile(agentsPath, previous, "utf8");
    await fs.writeFile(`${agentsPath}.bak`, "older backup\n", "utf8");

    const result = await commitAgentsUpdate(
      agentsPath,
      prepareAgentsUpdate(previous, generatedContent("replacement"))
    );

    expect(result.backupPath).toBe(`${agentsPath}.bak.1`);
    expect(await fs.readFile(`${agentsPath}.bak`, "utf8")).toBe(
      "older backup\n"
    );
    expect(await fs.readFile(`${agentsPath}.bak.1`, "utf8")).toBe(previous);
  });

  it("rejects AGENTS.md when it is a symbolic link", async () => {
    const fixture = await createFixture();
    const targetPath = path.join(fixture, "target.md");
    const agentsPath = path.join(fixture, "AGENTS.md");
    await fs.writeFile(targetPath, "target content\n", "utf8");
    await fs.symlink(targetPath, agentsPath);

    await expect(readAgentsContent(agentsPath)).rejects.toThrow(
      "Refusing to update symbolic link"
    );
    expect(await fs.readFile(targetPath, "utf8")).toBe("target content\n");
  });

  it("aborts when AGENTS.md changes after the preview", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "legacy content\n";
    const concurrent = "changed by another process\n";
    await fs.writeFile(agentsPath, previous, "utf8");
    const update = prepareAgentsUpdate(previous, generatedContent("replacement"));
    await fs.writeFile(agentsPath, concurrent, "utf8");

    await expect(commitAgentsUpdate(agentsPath, update)).rejects.toThrow(
      "changed after the preview"
    );
    expect(await fs.readFile(agentsPath, "utf8")).toBe(concurrent);
    expect(await listTemporaryFiles(fixture)).toEqual([]);
  });

  it("keeps the old file complete and removes the temporary file after a write failure", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "complete old content\n";
    await fs.writeFile(agentsPath, previous, "utf8");

    const originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementationOnce(
      async (filePath, flags, mode) => {
        const handle = await originalOpen(filePath, flags, mode);
        const originalWriteFile = handle.writeFile.bind(handle);

        handle.writeFile = (async () => {
          await originalWriteFile("partial new content", "utf8");
          throw new Error("simulated write failure");
        }) as typeof handle.writeFile;

        return handle;
      }
    );

    await expect(
      commitAgentsUpdate(
        agentsPath,
        prepareAgentsUpdate(previous, generatedContent("replacement"))
      )
    ).rejects.toThrow("simulated write failure");

    expect(await fs.readFile(agentsPath, "utf8")).toBe(previous);
    expect(await listTemporaryFiles(fixture)).toEqual([]);
  });

  it("preserves permissions from an existing AGENTS.md", async () => {
    const fixture = await createFixture();
    const agentsPath = path.join(fixture, "AGENTS.md");
    const previous = "legacy content\n";
    await fs.writeFile(agentsPath, previous, { encoding: "utf8", mode: 0o640 });
    await fs.chmod(agentsPath, 0o640);

    await commitAgentsUpdate(
      agentsPath,
      prepareAgentsUpdate(previous, generatedContent("replacement"))
    );

    expect((await fs.stat(agentsPath)).mode & 0o777).toBe(0o640);
  });

  it("rejects duplicated or incomplete markers", () => {
    const duplicated = `${generatedContent("one")}${generatedContent("two")}`;

    expect(() =>
      prepareAgentsUpdate(duplicated, generatedContent("new"))
    ).toThrow("invalid Adão markers");
    expect(() =>
      prepareAgentsUpdate(`${ADAO_START_MARKER}\nmissing end`, generatedContent("new"))
    ).toThrow("invalid Adão markers");
  });
});

function generatedContent(value: string): string {
  return wrapManagedAgentsContent(`# Generated\n\n${value}\n`);
}

async function createFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adao-apply-"));
  tempDirs.push(directory);
  return directory;
}

async function listTemporaryFiles(directory: string): Promise<string[]> {
  return (await fs.readdir(directory)).filter((file) =>
    file.startsWith(".AGENTS.md.adao.tmp")
  );
}
