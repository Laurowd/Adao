import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

export const ADAO_START_MARKER = "<!-- adao:start -->";
export const ADAO_END_MARKER = "<!-- adao:end -->";

export type AgentsUpdateKind = "create" | "managed" | "legacy";

export interface PreparedAgentsUpdate {
  kind: AgentsUpdateKind;
  previousContent: string | null;
  nextContent: string;
}

export interface CommittedAgentsUpdate {
  backupPath: string | null;
}

interface AgentsSnapshot {
  content: string;
  mode: number;
}

interface OpenTemporaryFile {
  handle: FileHandle;
  path: string;
}

export function wrapManagedAgentsContent(content: string): string {
  const contentWithNewline = content.endsWith("\n") ? content : `${content}\n`;

  return `${ADAO_START_MARKER}\n${contentWithNewline}${ADAO_END_MARKER}\n`;
}

export function prepareAgentsUpdate(
  previousContent: string | null,
  generatedContent: string
): PreparedAgentsUpdate {
  const generatedBlock = findManagedBlock(generatedContent, "generated content");

  if (!generatedBlock) {
    throw new Error("Generated content is missing Adão markers.");
  }

  if (previousContent === null) {
    return {
      kind: "create",
      previousContent,
      nextContent: generatedContent
    };
  }

  const previousBlock = findManagedBlock(previousContent, "AGENTS.md", true);

  if (!previousBlock) {
    return {
      kind: "legacy",
      previousContent,
      nextContent: generatedContent
    };
  }

  return {
    kind: "managed",
    previousContent,
    nextContent: `${previousContent.slice(0, previousBlock.contentStart)}${generatedContent.slice(
      generatedBlock.contentStart,
      generatedBlock.contentEnd
    )}${previousContent.slice(previousBlock.contentEnd)}`
  };
}

export async function readAgentsContent(
  agentsPath: string
): Promise<string | null> {
  return (await readAgentsSnapshot(agentsPath))?.content ?? null;
}

export async function commitAgentsUpdate(
  agentsPath: string,
  update: PreparedAgentsUpdate
): Promise<CommittedAgentsUpdate> {
  const initialSnapshot = await readAgentsSnapshot(agentsPath);
  assertExpectedContent(initialSnapshot?.content ?? null, update.previousContent);

  if (update.nextContent === update.previousContent) {
    return { backupPath: null };
  }

  const temporaryFile = await openTemporaryFile(
    agentsPath,
    initialSnapshot?.mode
  );
  let temporaryHandleOpen = true;

  try {
    await temporaryFile.handle.writeFile(update.nextContent, "utf8");
    await temporaryFile.handle.sync();
    await temporaryFile.handle.close();
    temporaryHandleOpen = false;

    await assertAgentsUnchanged(agentsPath, update.previousContent);

    const backupPath = initialSnapshot
      ? await writeAvailableBackup(
          agentsPath,
          update.previousContent ?? "",
          initialSnapshot.mode
        )
      : null;

    await assertAgentsUnchanged(agentsPath, update.previousContent);
    await fs.rename(temporaryFile.path, agentsPath);

    return { backupPath };
  } catch (error) {
    if (temporaryHandleOpen) {
      await temporaryFile.handle.close().catch(() => undefined);
    }

    await removeIfExists(temporaryFile.path);
    throw error;
  }
}

interface ManagedBlock {
  contentStart: number;
  contentEnd: number;
}

function findManagedBlock(
  content: string,
  label: string,
  allowAbsent = false
): ManagedBlock | null {
  const startIndex = content.indexOf(ADAO_START_MARKER);
  const endIndex = content.indexOf(ADAO_END_MARKER);
  const hasStart = startIndex !== -1;
  const hasEnd = endIndex !== -1;

  if (!hasStart && !hasEnd && allowAbsent) {
    return null;
  }

  const hasExactlyOneStart =
    hasStart && startIndex === content.lastIndexOf(ADAO_START_MARKER);
  const hasExactlyOneEnd =
    hasEnd && endIndex === content.lastIndexOf(ADAO_END_MARKER);

  if (
    !hasExactlyOneStart ||
    !hasExactlyOneEnd ||
    startIndex + ADAO_START_MARKER.length > endIndex
  ) {
    throw new Error(
      `${label} has invalid Adão markers. Expected exactly one ${ADAO_START_MARKER} before exactly one ${ADAO_END_MARKER}.`
    );
  }

  return {
    contentStart: startIndex + ADAO_START_MARKER.length,
    contentEnd: endIndex
  };
}

async function assertAgentsUnchanged(
  agentsPath: string,
  expectedContent: string | null
): Promise<void> {
  const snapshot = await readAgentsSnapshot(agentsPath);
  assertExpectedContent(snapshot?.content ?? null, expectedContent);
}

function assertExpectedContent(
  currentContent: string | null,
  expectedContent: string | null
): void {
  if (currentContent !== expectedContent) {
    throw new Error(
      "AGENTS.md changed after the preview. Aborting without replacing it; review the new contents and run apply again."
    );
  }
}

async function readAgentsSnapshot(
  agentsPath: string
): Promise<AgentsSnapshot | null> {
  let stat;

  try {
    stat = await fs.lstat(agentsPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to update symbolic link: ${agentsPath}`);
  }

  if (!stat.isFile()) {
    throw new Error(`AGENTS.md is not a regular file: ${agentsPath}`);
  }

  return {
    content: await fs.readFile(agentsPath, "utf8"),
    mode: stat.mode & 0o777
  };
}

async function openTemporaryFile(
  agentsPath: string,
  existingMode?: number
): Promise<OpenTemporaryFile> {
  const directory = path.dirname(agentsPath);
  const basename = path.basename(agentsPath);

  for (let suffix = 0; ; suffix += 1) {
    const suffixText = suffix === 0 ? "" : `.${suffix}`;
    const temporaryPath = path.join(
      directory,
      `.${basename}.adao.tmp${suffixText}`
    );

    try {
      const handle = await fs.open(
        temporaryPath,
        "wx",
        existingMode ?? 0o666
      );

      try {
        if (existingMode !== undefined) {
          await handle.chmod(existingMode);
        }
      } catch (error) {
        await handle.close().catch(() => undefined);
        await removeIfExists(temporaryPath);
        throw error;
      }

      return { handle, path: temporaryPath };
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        continue;
      }

      throw error;
    }
  }
}

async function writeAvailableBackup(
  agentsPath: string,
  content: string,
  mode: number
): Promise<string> {
  for (let suffix = 0; ; suffix += 1) {
    const suffixText = suffix === 0 ? "" : `.${suffix}`;
    const backupPath = `${agentsPath}.bak${suffixText}`;
    let handle: FileHandle;

    try {
      handle = await fs.open(backupPath, "wx", mode);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        continue;
      }

      throw error;
    }

    try {
      await handle.chmod(mode);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      return backupPath;
    } catch (error) {
      await handle.close().catch(() => undefined);
      await removeIfExists(backupPath);
      throw error;
    }
  }
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT");
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasErrorCode(error, "EEXIST");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
