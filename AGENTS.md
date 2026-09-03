# AGENTS.md

## Project

ReqStorm — a Model Context Protocol (MCP) server for API testing, performance, contract, and security analysis. Published to npm as `reqstorm`. Runs over stdio.

## Commands

- `npm run build` — compile `src/` → `dist/` (TypeScript, Node16 module resolution)
- `npm run dev` — `tsc --watch`

## Architecture

- Entry point: `src/index.ts` — `#!/usr/bin/env node`, uses `serveStdio` from `@modelcontextprotocol/server/stdio` (v2 SDK).
- Each tool lives in `src/tools/<name>.ts`, exporting a Zod `*Schema` and a `*Handler`.
- Shared logic in `src/utils/`:
  - `autocannon.ts` — wraps the autocannon programmatic API; `runBenchmarkSplit` splits results into warm-up vs steady-state phases.
  - `http-client.ts` — Promise-based `httpRequest`/`parseJsonBody`/`statusClass` used by the non-autocannon tools (validate, chain, contract-check, fuzz, security-scan).
  - `jsonpath.ts` — `jsonpathEvaluate`/`jsonpathFirst` wrapper over `jsonpath-plus`.
  - `matchers.ts` — `evaluateMatch`/`MatcherOp`, the 12+ matcher operators.
  - `variables.ts` — `{{var}}` extraction/interpolation for `chain`.
  - `persistence.ts` — `.reqstorm/` save/load/`loadBaseline` for `regression`/`benchmark saveAs`.
  - `formatters.ts` — structured text output for all tools.
  - `types.ts` — shared result interfaces.
- Tools are registered in `src/index.ts` via `server.registerTool(name, { inputSchema }, handler)`.

## 14 Tools

Performance: `benchmark`, `smoke`, `load-test`, `spike`, `soak`, `stress-test`, `compare`.
Functional/contract: `validate`, `chain`, `contract-check`, `fuzz`, `regression`.
Security: `security-scan`. Profiling: `profile`.

## Conventions & Gotchas

- **MCP SDK v2 framing**: stdio transport uses **newline-delimited JSON**, NOT the old 4-byte length-prefix frame. A naive test client must send `JSON + "\n"`.
- **autocannon typings**: `@types/autocannon` uses `p97_5` and `p99_9` on the `Histogram` type (not `p95`/`p999`). Map these when extracting percentiles.
- **autocannon `onResponse`/`verifyBody`**: the `Options` type doesn't surface `onResponse` cleanly; cast options to `any` when using callbacks. For response-body validation prefer `verifyBody` (counts mismatches) over `onResponse`.
- `stress-test` `breakThreshold` must use `.partial().default({})` in the Zod schema or the generated JSON Schema marks it required.
- Warm-up is not discarded — results show warm-up vs steady-state blocks. `load-test` evaluates thresholds against steady-state only.
- The soak tool runs autocannon in repeated `reportInterval`-second chunks, not one long run.
- **Every handler MUST call `<schema>.parse(args)` as its first statement** (e.g. `args = validateSchema.parse(args)`). Zod defaults are otherwise only applied by the normal MCP tool-input path; a direct handler call with omitted optionals receives `undefined`, causing `undefined.includes()` / `NaN` crashes. Guards exist in all 14 handlers.
- **`contract-check`**: `SwaggerParser.validate(url)` can throw `Unable to resolve $ref pointer` for specs served from the target server; `loadSpecFallback` fetches the raw spec (JSON/YAML) and parses it instead. A **returned 401/403 status** marks the endpoint `skipped (auth required)` — not just thrown auth errors.
- **`fuzz`** mutates `{{...}}` placeholders in templates; when called without a body it generates direct mutations. `failStatuses` and `strategies` need `?? []`/`?? defaults` fallbacks (covered by the parse guard).
- **`profile`** builds latency buckets from the four percentile points (p50/p95/p99/p999); `Avg Response Size` was removed — autocannon's `requests.sent` is sent-request bytes, not response size, and was unreliable.
- **`validate`** occasionally hits its retry loop if a transient error occurs; pass explicit `retries` when calling directly (default is applied via parse guard now).

## Deployment

- Publish: `npm run build && npm publish`. `prepublishOnly` runs `build`.
- Package ships only `dist/`, `README.md`, `LICENSE` (see `files` in package.json).
- Users run via MCP host config: `{ "command": "npx", "args": ["-y", "reqstorm"] }`.
- Dependencies bundled: `jsonpath-plus` (JSONPath eval) and `@apidevtools/swagger-parser` (OpenAPI loading/validation). Both must stay in `dependencies` (not dev).

