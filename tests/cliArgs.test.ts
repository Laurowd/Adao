import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArgs } from "../src/cliArgs.js";

describe("parseCliArgs", () => {
  it.each([
    ["scan", "--json", { json: true, yes: false }],
    ["doctor", "--json", { json: true, yes: false }],
    ["generate", undefined, { json: false, yes: false }],
    ["suggest", "--json", { json: true, yes: false }],
    ["apply", "--yes", { json: false, yes: true }]
  ] as const)(
    "accepts the documented flags for %s",
    (command, flag, expectedFlags) => {
      const args = flag ? [command, ".", flag] : [command, "."];

      expect(parseCliArgs(args)).toEqual({
        kind: "command",
        command,
        projectPath: ".",
        ...expectedFlags
      });
    }
  );

  it.each(["scan", "doctor", "suggest"] as const)(
    "accepts --json before or after the %s project path",
    (command) => {
      expect(parseCliArgs([command, "--json", "project"])).toEqual(
        parseCliArgs([command, "project", "--json"])
      );
    }
  );

  it("accepts --yes before or after the apply project path", () => {
    expect(parseCliArgs(["apply", "--yes", "project"])).toEqual(
      parseCliArgs(["apply", "project", "--yes"])
    );
  });

  it.each(["--help", "-h"])("accepts global help with %s", (flag) => {
    expect(parseCliArgs([flag])).toEqual({ kind: "global-help" });
  });

  it.each(["--version", "-V"])("accepts version with %s", (flag) => {
    expect(parseCliArgs([flag])).toEqual({ kind: "version" });
  });

  it.each(["scan", "doctor", "generate", "suggest", "apply"] as const)(
    "accepts help for %s",
    (command) => {
      expect(parseCliArgs([command, "--help"])).toEqual({
        kind: "command-help",
        command
      });
      expect(parseCliArgs([command, "-h"])).toEqual({
        kind: "command-help",
        command
      });
    }
  );

  it.each([
    [[], "Missing command"],
    [["unknown", "."], "Unknown command 'unknown'"],
    [["scan"], "Missing projectPath"],
    [["scan", "one", "two"], "exactly one projectPath"],
    [["scan", ".", "--josn"], "Unknown flag '--josn'"],
    [["scan", ".", "--json", "--json"], "Duplicate flag '--json'"],
    [["scan", ".", "--json=value"], "Unknown flag '--json=value'"],
    [["generate", ".", "--json"], "Unknown flag '--json'"],
    [["doctor", ".", "--yes"], "Unknown flag '--yes'"],
    [["apply", ".", "--json"], "Unknown flag '--json'"],
    [["apply", ".", "--yes", "--yes"], "Duplicate flag '--yes'"],
    [["scan", "--help", "."], "does not accept a project path"],
    [["--version", "extra"], "does not accept arguments"]
  ] as const)("rejects invalid input %#", (args, message) => {
    expect(() => parseCliArgs([...args])).toThrow(CliUsageError);
    expect(() => parseCliArgs([...args])).toThrow(message);
  });
});
