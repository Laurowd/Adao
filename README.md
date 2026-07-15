# Adão

[![CI status](https://github.com/Laurowd/Adao/actions/workflows/ci.yml/badge.svg)](https://github.com/Laurowd/Adao/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/%40laurowd%2Fadao.svg)](https://www.npmjs.com/package/@laurowd/adao)

English | [Português](README.pt-BR.md)

Adão is a local-first CLI for projects that use `AGENTS.md`. It scans a
project, audits whether its instructions still match local evidence, generates
deterministic context, prepares a structured prompt for a separate AI review,
and safely applies managed updates.

## Why Adão exists

Coding agents rely on accurate project instructions. An outdated, vague, or
oversized `AGENTS.md` can point to missing commands, describe the wrong stack,
or consume context without helping.

Adão turns evidence already present in a repository into a repeatable workflow:
inspect the project, diagnose suspicious instructions, generate a conservative
baseline, optionally prepare that evidence for external AI review, and update
only the content Adão manages when markers are present.

## Quick start

Adão requires Node.js 18 or later. Version 0.1.0 is available on npm as
`@laurowd/adao`:

```bash
npm install -g @laurowd/adao
```

Use the installed `adao` command in a project:

```bash
adao scan .
adao doctor .
adao generate .
adao suggest .
adao apply .
```

To run a command without installing Adão globally:

```bash
npx @laurowd/adao scan .
```

The five project commands cover distinct parts of the workflow:

| Command | Purpose |
| --- | --- |
| `scan` | Inventory project evidence such as languages, scripts, tools, and structure. |
| `doctor` | Check whether the current `AGENTS.md` is still consistent with detected evidence. |
| `generate` | Print a deterministic `AGENTS.md` baseline derived from local evidence. |
| `suggest` | Build a structured prompt for a separate review by Codex, ChatGPT, or another AI. |
| `apply` | Preview and safely write the generated managed content. |

## Commands

The current CLI contract is:

```text
adao scan <projectPath> [--json]
adao doctor <projectPath> [--json]
adao generate <projectPath>
adao suggest <projectPath> [--json]
adao apply <projectPath> [--yes]

adao --help
adao --version
```

`scan`, `doctor`, and `suggest` support optional JSON output. `apply` asks for
confirmation unless `--yes` is supplied. Invalid usage exits with code `2`;
operational failures and a `doctor` result containing errors exit with code `1`.
Usage and operational errors are concise and do not print stack traces.

Each command also supports command-specific help, for example
`adao apply --help`.

### `scan`

`scan` reads the project tree and collects evidence including:

- project name, package description, and a locally derived overview;
- languages detected from file extensions;
- a conservative set of frameworks and tools detected from package metadata;
- package scripts and package manager evidence;
- important files and relevant project directories;
- the presence of `README.md`, Git metadata, and `AGENTS.md`.

The default text output summarizes the scan; `--json` exposes the complete
structured result, including package description and derived overview fields.

```bash
adao scan .
adao scan . --json
```

The scanner examines up to 5,000 filesystem entries by default and reports how
many entries it inspected, whether the limit was reached, and any unreadable
paths. Its text and JSON output expose whether the result is complete. A
truncated scan or a blocking filesystem error makes the evidence incomplete;
`doctor` reports that condition as an error, while `generate`, `suggest`, and
`apply` refuse to continue from partial evidence.

Scan completeness refers to filesystem traversal completeness. It does not mean
universal understanding of every framework, nested package, or project
architecture. The current version reads dependency metadata from the root
`package.json` only and does not aggregate nested `package.json` files.

Detection is deliberately finite rather than universal. Language detection is
extension-based, and framework/tool detection recognizes a defined set of
package dependencies.

### `doctor`

`doctor` validates the current `AGENTS.md` against detected project evidence
and reports `error`, `warning`, and `info` issues, followed by a `healthy`,
`needs attention`, or `broken` status.

```bash
adao doctor .
adao doctor . --json
```

Checks currently cover cases such as:

- a missing `AGENTS.md`;
- package commands that do not match available `package.json` scripts;
- commands that use a package manager inconsistent with detected evidence;
- stack declarations that appear inconsistent with the detected project;
- vague guidance and excessive file size;
- possible staleness when `README.md` or `package.json` is newer;
- a simple package-manager conflict with global `~/.codex/AGENTS.md` guidance;
- an incomplete project scan.

Stack validation is heuristic and conservative. It looks for assertive stack
declarations and avoids treating negative guidance or clearly hypothetical
examples as project facts. A lockfile becoming newer does not, by itself, make
`AGENTS.md` stale.

### `generate`

`generate` prints an `AGENTS.md` draft without writing files or calling an
external service.

```bash
adao generate .
```

Generation is deterministic and uses only local evidence such as validated
`package.json` metadata, `README.md`, package scripts, detected stack, package
manager evidence, and project structure. A package description takes priority
for the project overview; otherwise Adão uses useful README content. When the
available evidence is not sufficient, it writes an explicit `TODO` instead of
inventing a goal, command, stack, or architecture.

Generated content is wrapped in a managed region:

```markdown
<!-- adao:start -->

<!-- generated content -->

<!-- adao:end -->
```

These markers let `apply` distinguish Adão-managed content from manual content.
Generation is blocked when the scan is incomplete, package-manager evidence
conflicts, or an unsupported `packageManager` declaration has no recognized
lockfile to resolve it.

### `suggest`

`suggest` prepares a structured Markdown prompt from the local scan, current
doctor result, deterministic generated draft, and a conservative selection of
local evidence files.

```bash
adao suggest .
adao suggest . --json
```

It does **not** call the OpenAI API, invoke an LLM, or send project files to any
service. Adão only prints the prompt (or returns it as part of the JSON result).
You may then give that prompt separately to Codex, ChatGPT, or another AI for
review. Adão does not perform that review itself.

The prompt tells the reviewer to use only the supplied evidence, preserve
detected commands, avoid invented project details, and use TODOs where evidence
is missing. Evidence files and total prompt evidence are size-limited, and
truncation is marked in the prompt.

### `apply`

`apply` prepares the same deterministic content as `generate`, shows the
proposed content or a diff, and asks for confirmation before writing. Use
`--yes` only when non-interactive confirmation is intended.

```bash
adao apply .
adao apply . --yes
```

Its update behavior depends on the existing file:

- if `AGENTS.md` does not exist, Adão creates a marked file;
- if valid Adão markers exist, it replaces only the managed region and
  preserves content before and after it byte for byte;
- if a legacy `AGENTS.md` has no markers, Adão warns that the whole file will be
  replaced and that manual content will not remain in the active file. It asks
  for confirmation and creates a backup before replacement;
- malformed, duplicated, or incomplete markers are rejected.

For replacements, Adão creates the first available numbered backup
(`AGENTS.md.bak`, `AGENTS.md.bak.1`, and so on) without overwriting older
backups. It writes the new content to a temporary file in the same directory,
flushes and closes it, checks that `AGENTS.md` has not changed since the
preview, then renames the temporary file over the target. This is an atomic
replacement strategy on filesystems that provide atomic same-directory rename;
it is not a claim of absolute atomicity across every filesystem or failure
mode.

The writer preserves the existing file's permission bits, rejects an
`AGENTS.md` symbolic link, revalidates content before replacement to reduce the
risk of overwriting concurrent edits, and removes its temporary file when an
update fails. Unsafe or incomplete project evidence is rejected before the
confirmation and write steps.

## Safety guarantees

- **Local-first:** scan, validation, generation, suggestion preparation, and
  application run locally.
- **No external upload:** Adão does not send project files to external services.
- **Deterministic generation:** the same accepted evidence follows fixed local
  rules; missing context becomes a TODO.
- **Complete filesystem traversal required:** truncated scans or blocking read
  errors stop `generate`, `suggest`, and `apply`, and are errors in `doctor`.
- **Manual content boundaries:** content outside valid Adão markers is preserved
  byte for byte. Legacy unmarked files receive an explicit replacement warning
  and a backup.
- **Non-destructive backups:** existing backup names are never reused.
- **Careful replacement:** temporary-file writing, same-directory rename,
  permission preservation, symlink rejection, and concurrent-content checks
  reduce write risk.
- **No silent unsafe overwrite:** invalid markers, conflicting package-manager
  evidence, incomplete scans, and detected concurrent changes abort the update.

## How it works

1. The filesystem walker skips common generated or vendor directories and
   records scan completeness.
2. The scanner validates relevant fields from the root `package.json` and
   derives a bounded set of facts from filenames, package metadata, README
   content, and directory structure.
3. `doctor` compares the current instructions with those facts using
   conservative checks.
4. `generate` turns accepted facts into a short marked baseline. `suggest`
   packages that baseline and selected evidence into a prompt for an external
   reviewer.
5. `apply` previews the exact next file and uses the guarded write workflow
   described above.

Adão itself has no network or AI integration. Only the separately chosen tool
that receives a `suggest` prompt would perform an AI review.

## Current limitations

- The current heuristics are initially optimized for Node.js and TypeScript
  projects, although the scanner recognizes a limited set of other file
  extensions and ecosystems.
- Stack and tool detection is based on a defined package-dependency list; it
  does not identify every framework or infer arbitrary architecture.
- Nested `package.json` files are not aggregated. Dependencies and scripts from
  nested applications or packages are outside the detected root stack.
- `AGENTS.md` validation is conservative and cannot fully understand natural
  language or prove that instructions are semantically correct.
- `suggest` selects a bounded set of conventional evidence files rather than
  understanding the entire repository semantically.
- There is no embedded LLM, GUI, plugin system, database, or automatic
  project-wide semantic analysis.

## Development

To work from a repository checkout:

```bash
git clone https://github.com/Laurowd/Adao.git
cd Adao
npm ci
npm run build
node dist/cli.js --help
```

Run the CLI directly from TypeScript during development:

```bash
npm run dev -- scan .
npm run dev -- doctor .
npm run dev -- generate .
npm run dev -- suggest .
npm run dev -- apply .
```

Install the locked dependencies and run the main checks:

```bash
npm ci
npm test
npm run build
npm audit
```

Package validation is available locally as well:

```bash
npm pack --dry-run
npm run test:package
```

`npm run test:package` builds a real tarball, installs it into a temporary
project, verifies `adao --help`, `adao --version`, and `adao scan`, and checks
that development-only files and dependencies are not shipped.

The GitHub Actions workflow currently runs the test suite and build on Node.js
18 and Node.js 22. A separate Node.js 22 packaging job runs `npm audit`, inspects
an npm package dry run, then installs and executes the real tarball.

## Project structure

```text
.github/workflows/
  ci.yml                    # Node 18/22 tests, build, audit, and package checks
scripts/
  clean.mjs                 # removes compiled output before builds
  package-smoke.mjs         # packs, installs, and executes the real tarball
src/
  cli.ts                    # command dispatch, formatting, and exit behavior
  cliArgs.ts                # strict command and flag parsing
  packageVersion.ts         # reads the CLI version from package.json
  core/
    applyAgents.ts          # managed regions, backups, and guarded writes
    detectStack.ts          # language, tool, structure, and manager detection
    diffAgents.ts           # line-oriented preview diff
    generateAgents.ts       # deterministic managed AGENTS.md generation
    readPackageJson.ts      # package metadata parsing and validation
    scanProject.ts          # scan orchestration and completeness guards
    suggestAgents.ts        # local evidence selection and prompt construction
    types.ts                # shared domain types
    validateAgents.ts       # doctor rules and status calculation
  utils/
    fs.ts                   # bounded filesystem traversal
    paths.ts                # path normalization helpers
tests/                      # unit and CLI workflow coverage
```

## License

[MIT License](LICENSE)
