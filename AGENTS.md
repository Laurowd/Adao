# AGENTS.md

## Project overview

Adão is a local-first CLI tool that helps developers maintain reliable `AGENTS.md` files for AI coding agent workflows.

It scans local projects, detects stack/scripts/structure, validates existing `AGENTS.md` files, generates honest suggested context, and applies changes only with preview or explicit confirmation.

This MVP is intentionally deterministic: no LLM, no external API, no database, no Tauri, and no graphical UI.

## Tech stack

- Package manager: npm
- Runtime: Node.js
- Language: TypeScript
- Tests: Vitest
- CLI execution: `node --import tsx src/cli.ts`

## Common commands

- `npm run dev -- scan .`: Run the CLI scan command locally
- `npm run dev -- doctor .`: Validate this project's `AGENTS.md`
- `npm run dev -- doctor . --json`: Validate and print machine-readable output
- `npm run dev -- generate .`: Generate suggested `AGENTS.md` content
- `npm run dev -- apply .`: Preview and apply generated `AGENTS.md`
- `npm run build`: Compile TypeScript
- `npm run test`: Run tests
- `npm audit`: Check dependency vulnerabilities

## Project structure

- `src/cli.ts`: CLI entrypoint and command handling
- `src/core/`: Core scan, generate, validate, diff, and type logic
- `src/utils/`: Filesystem and path helpers
- `tests/`: Automated tests for core behavior and CLI workflows
- `AGENTS.md`: Project instructions used by coding agents
- `README.md`: Human-facing project documentation

## Validation

Before finishing code changes, run the relevant checks:

- `npm run test`
- `npm run build`
- `npm audit`

When changing CLI behavior, also run at least:

- `npm run dev -- scan .`
- `npm run dev -- doctor .`
- `npm run dev -- doctor . --json`
- `npm run dev -- generate .`

## Agent rules

- Keep the project CLI-first until explicitly asked to add UI.
- Do not add Tauri, Electron, database, authentication, or external AI/API integration in this MVP.
- Prefer deterministic heuristics over generated or inferred context.
- Never make `generate` invent project goals, stack, commands, or architecture.
- Use explicit TODOs when reliable local information is missing.
- Keep changes small, focused, and covered by tests.
- Preserve the separation between CLI code and reusable core logic.
- Do not silently overwrite `AGENTS.md`; preserve preview, diff, confirmation, and backup behavior.
- Update tests when changing scan, doctor, generate, or apply behavior.
- Update this file when project commands, architecture, or product constraints change.
