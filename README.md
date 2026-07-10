# Adao

Adao is a local CLI productivity tool for projects that use code agents. It scans a project, checks whether `AGENTS.md` still matches the codebase, and can generate a short suggested replacement.

The MVP does not use an external API, LLM, database, authentication, Tauri, or a graphical UI. It is focused on a small, testable core that a future UI can reuse.

## Why it exists

AI coding agents depend on reliable project context. A stale, vague, or oversized `AGENTS.md` can make the agent follow the wrong commands or waste context window budget. Adao acts as a local "Context Doctor" for that file.

## Install

```bash
npm install
```

## Develop

```bash
npm run dev -- scan .
npm run dev -- doctor .
npm run dev -- generate .
```

Build and test:

```bash
npm run build
npm test
```

After building, the CLI entry is available at `dist/cli.js`. The package also exposes the `adao` binary when installed as a package.

## Commands

### scan

Analyze a project directory.

```bash
npm run dev -- scan .
npm run dev -- scan . --json
```

Example output:

```text
Project: adao
Path: /path/to/adao
Git repository: no
AGENTS.md: no
README.md: yes
Package manager: npm
Languages: TypeScript
Frameworks/tools: Vitest
Scripts:
  dev: node --import tsx src/cli.ts
  build: tsc -p tsconfig.json
  test: vitest run
Important files: package.json, tsconfig.json
```

### doctor

Validate `AGENTS.md` and report `error`, `warning`, and `info` issues.

```bash
npm run dev -- doctor .
```

Checks include:

- missing `AGENTS.md`
- commands in `AGENTS.md` that do not exist in `package.json`
- mentioned stack that was not detected in the project
- files over 4000 or 8000 characters
- vague phrases such as "write clean code"
- `AGENTS.md` older than `package.json`, lockfiles, or `README.md`
- simple conflict with `~/.codex/AGENTS.md` package manager guidance

### generate

Print a suggested `AGENTS.md` without writing to disk.

```bash
npm run dev -- generate .
```

### apply

Generate the suggested `AGENTS.md`, show a diff when the file already exists, ask for confirmation, and create `AGENTS.md.bak` before overwriting.

```bash
npm run dev -- apply .
```

## Project layout

```text
src/
  cli.ts
  core/
    scanProject.ts
    detectStack.ts
    readPackageJson.ts
    validateAgents.ts
    generateAgents.ts
    diffAgents.ts
    types.ts
  utils/
    fs.ts
    paths.ts
tests/
  scanProject.test.ts
  validateAgents.test.ts
  generateAgents.test.ts
```
