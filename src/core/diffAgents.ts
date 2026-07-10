export function diffAgents(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);
  const table = buildLcsTable(oldLines, newLines);
  const output = ["--- AGENTS.md", "+++ AGENTS.md (suggested)"];

  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      output.push(` ${oldLines[oldIndex]}`);
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (table[oldIndex + 1]?.[newIndex] >= table[oldIndex]?.[newIndex + 1]) {
      output.push(`-${oldLines[oldIndex]}`);
      oldIndex += 1;
    } else {
      output.push(`+${newLines[newIndex]}`);
      newIndex += 1;
    }
  }

  while (oldIndex < oldLines.length) {
    output.push(`-${oldLines[oldIndex]}`);
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    output.push(`+${newLines[newIndex]}`);
    newIndex += 1;
  }

  return output.join("\n");
}

function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
  const table = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0)
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        table[oldIndex][newIndex] = table[oldIndex + 1][newIndex + 1] + 1;
      } else {
        table[oldIndex][newIndex] = Math.max(
          table[oldIndex + 1][newIndex],
          table[oldIndex][newIndex + 1]
        );
      }
    }
  }

  return table;
}
