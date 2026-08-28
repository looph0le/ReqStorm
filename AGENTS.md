# AGENTS.md

## Project

ReqStorm — a Model Context Protocol (MCP) server for API performance testing. Published to npm as `reqstorm`. Runs over stdio.

## Commands

- `npm run build` — compile `src/` → `dist/` (TypeScript, Node16 module resolution)
- `npm run dev` — `tsc --watch`

## Architecture

- Entry point: `src/index.ts` — `#!/usr/bin/env node`, uses `serveStdio` from `@modelcontextprotocol/server/stdio` (v2 SDK).
- Each tool lives in `src/tools/<name>.ts`, exporting a Zod `*Schema` and a `*Handler`.
- Shared logic in `src/utils/`:
  - `autocannon.ts` — wraps the autocannon programmatic API; `runBenchmarkSplit` splits results into warm-up vs steady-state phases.
  - `formatters.ts` — structured text output for all tools.
  - `types.ts` — shared result interfaces.
- Tools are registered in `src/index.ts` via `server.registerTool(name, { inputSchema }, handler)`.

## 7 Tools

`benchmark`, `smoke`, `load-test`, `spike`, `soak`, `stress-test`, `compare`.

## Conventions & Gotchas

- **MCP SDK v2 framing**: stdio transport uses **newline-delimited JSON**, NOT the old 4-byte length-prefix frame. A naive test client must send `JSON + "\n"`.
- **autocannon typings**: `@types/autocannon` uses `p97_5` and `p99_9` on the `Histogram` type (not `p95`/`p999`). Map these when extracting percentiles.
- **autocannon `onResponse`/`verifyBody`**: the `Options` type doesn't surface `onResponse` cleanly; cast options to `any` when using callbacks. For response-body validation prefer `verifyBody` (counts mismatches) over `onResponse`.
- `stress-test` `breakThreshold` must use `.partial().default({})` in the Zod schema or the generated JSON Schema marks it required.
- Warm-up is not discarded — results show warm-up vs steady-state blocks. `load-test` evaluates thresholds against steady-state only.
- The soak tool runs autocannon in repeated `reportInterval`-second chunks, not one long run.

## Deployment

- Publish: `npm run build && npm publish`. `prepublishOnly` runs `build`.
- Package ships only `dist/`, `README.md`, `LICENSE` (see `files` in package.json).
- Users run via MCP host config: `{ "command": "npx", "args": ["-y", "reqstorm"] }`.
