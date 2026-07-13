export const COMMAND_NAMES = [
  "scan",
  "doctor",
  "generate",
  "suggest",
  "apply"
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

export type ParsedCliInput =
  | { kind: "global-help" }
  | { kind: "version" }
  | { kind: "command-help"; command: CommandName }
  | {
      kind: "command";
      command: CommandName;
      projectPath: string;
      json: boolean;
      yes: boolean;
    };

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

interface CommandDefinition {
  flags: ReadonlySet<string>;
  supportsJson: boolean;
}

const HELP_FLAGS = new Set(["--help", "-h"]);
const COMMAND_DEFINITIONS: Record<CommandName, CommandDefinition> = {
  scan: { flags: new Set(["--json"]), supportsJson: true },
  doctor: { flags: new Set(["--json"]), supportsJson: true },
  generate: { flags: new Set(), supportsJson: false },
  suggest: { flags: new Set(["--json"]), supportsJson: true },
  apply: { flags: new Set(["--yes"]), supportsJson: false }
};

export function parseCliArgs(argv: string[]): ParsedCliInput {
  if (argv.length === 0) {
    throw new CliUsageError("Missing command. Run 'adao --help' for usage.");
  }

  if (argv[0] === "--help" || argv[0] === "-h") {
    requireExactGlobalOption(argv, argv[0]);
    return { kind: "global-help" };
  }

  if (argv[0] === "--version" || argv[0] === "-V") {
    requireExactGlobalOption(argv, argv[0]);
    return { kind: "version" };
  }

  const command = parseCommandName(argv[0]);
  const definition = COMMAND_DEFINITIONS[command];
  const positionals: string[] = [];
  const seenFlags = new Set<string>();
  let help = false;
  let json = false;
  let yes = false;

  for (const token of argv.slice(1)) {
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const canonicalFlag = HELP_FLAGS.has(token) ? "--help" : token;
    if (seenFlags.has(canonicalFlag)) {
      throw new CliUsageError(
        `Duplicate flag '${token}' for command '${command}'.`
      );
    }
    seenFlags.add(canonicalFlag);

    if (HELP_FLAGS.has(token)) {
      help = true;
    } else if (!definition.flags.has(token)) {
      throw new CliUsageError(
        `Unknown flag '${token}' for command '${command}'.`
      );
    } else if (token === "--json") {
      json = true;
    } else if (token === "--yes") {
      yes = true;
    }
  }

  if (help) {
    if (positionals.length > 0 || seenFlags.size > 1) {
      throw new CliUsageError(
        `Help for '${command}' does not accept a project path or other flags.`
      );
    }
    return { kind: "command-help", command };
  }

  if (positionals.length === 0) {
    throw new CliUsageError(`Missing projectPath for command '${command}'.`);
  }
  if (positionals.length > 1) {
    throw new CliUsageError(
      `Command '${command}' accepts exactly one projectPath; received ${positionals.length}.`
    );
  }

  return {
    kind: "command",
    command,
    projectPath: positionals[0],
    json,
    yes
  };
}

export function recognizesJsonErrorMode(argv: string[]): boolean {
  const command = argv[0];
  return (
    isCommandName(command) &&
    COMMAND_DEFINITIONS[command].supportsJson &&
    argv.slice(1).includes("--json")
  );
}

function requireExactGlobalOption(argv: string[], option: string): void {
  if (argv.length !== 1) {
    throw new CliUsageError(`Global option '${option}' does not accept arguments.`);
  }
}

function parseCommandName(value: string): CommandName {
  if (!isCommandName(value)) {
    throw new CliUsageError(`Unknown command '${value}'. Run 'adao --help' for usage.`);
  }
  return value;
}

function isCommandName(value: string): value is CommandName {
  return COMMAND_NAMES.some((command) => command === value);
}
