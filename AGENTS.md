# AGENTS.md

## Project

ReqStorm — a Model Context Protocol (MCP) server for API testing, performance, contract, and security analysis. Published to npm as `reqstorm`. Runs over stdio.

## Commands

- `npm run build` — compile `src/` → `dist/` (TypeScript, Node16 module resolution)
- `npm run dev` — `tsc --watch`
- `npm test` — vitest suite (unit + local-mock-server integration tests in `test/`)
- `npm run lint` — `tsc --noEmit` + `prettier --check` (typescript-eslint is **not** installable: its peer range excludes TypeScript 7)
- `npm run format` — `prettier --write .`

## Architecture

- Entry point: `src/index.ts` — `#!/usr/bin/env node`, uses `serveStdio` from `@modelcontextprotocol/server/stdio` (v2 SDK).
- Each tool lives in `src/tools/<name>.ts`, exporting a Zod `*Schema` and a `*Handler`.
- Shared logic in `src/utils/`:
  - `autocannon.ts` — wraps the autocannon programmatic API; `runBenchmarkSplit` splits results into warm-up vs steady-state phases.
  - `http-client.ts` — Promise-based `httpRequest`/`parseJsonBody`/`statusClass` used by the non-autocannon tools (validate, chain, contract-check, fuzz, security-scan).
  - `jsonpath.ts` — `jsonpathEvaluate`/`jsonpathFirst` wrapper over `jsonpath-plus`.
  - `matchers.ts` — `evaluateMatch`/`MatcherOp`/`matcherSchema`, the 12+ matcher operators. `matcherSchema` is the shared Zod schema (imported by `validate` and `chain`) with per-op `superRefine` (ops needing `expected`: equals/notEquals/contains/gt/lt/gte/lte/isType/hasLength; `matches` needs `pattern`).
  - `variables.ts` — `{{var}}` extraction/interpolation for `chain`.
  - `persistence.ts` — `.reqstorm/` save/load/`loadBaseline` for `regression`/`benchmark saveAs`.
  - `formatters.ts` — structured text output for all tools.
  - `tool-result.ts` — `toolResult(data)`/`toolError(message, code)` helpers returning MCP `CallToolResult` with `structuredContent`. All 14 handlers return these.
  - `progress.ts` — `reportProgress(ctx, progress, total?, message?)` + `ProgressCtx` for MCP progress notifications.
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
- **`<schema>.parse(args)` first statement**: Every handler MUST call `<schema>.parse(args)` as its first statement (e.g. `args = validateSchema.parse(args)`). Zod defaults are otherwise only applied by the normal MCP tool-input path; a direct handler call with omitted optionals receives `undefined`, causing `undefined.includes()` / `NaN` crashes. Guards exist in all 14 handlers.
- **`tool-result.ts`/`structuredContent`**: the MCP SDK v2 `CallToolResult` type carries an index signature `{ [x: string]: unknown }`; the result objects must be declared as a **`type` with `[key: string]: unknown`** (an `interface` without an index signature is NOT assignable, and fail-safe extends matter). Handlers return `toolResult(data)` with `data: object`; `structuredContent` mirrors the result object, and `isError` is set by `toolError`. A non-object/non-`structuredContent` result is wrapped by the SDK as `{ type: 'text', text: string }`.
- **Progress notifications**: the MCP SDK v2 request context exposes the client progress token at `ctx.mcpReq?._meta?.progressToken` and a runtime-only `ctx.mcpReq.notify({ method: 'notifications/progress', params })` (not typed on `ServerContext`; use the structural `ProgressCtx` type from `progress.ts`). Long-running handlers take a second parameter `ctx: ProgressCtx = {}` and call `reportProgress`; it no-ops without a token/notify and skips `progress <= 0`. `runBenchmarkSplit`/`executeAutocannon` accept `onTick?(elapsedSeconds, totalSeconds)` (wall-clock, from `Date.now()` — autocannon's `tick` event carries a request counter, not seconds); `smoke`/`profile` wire the raw `instance.on('tick')` inline. `soak` reports per snapshot; `stress-test` per step.
- **Version source of truth** is `package.json`. Read it from `src/utils/package.ts` (exports `PACKAGE_NAME`/`VERSION`) — used by `index.ts` (MCP server version) and `http-client.ts` (User-Agent). Never hardcode the version.
- **Version/`User-Agent`**: `src/utils/package.ts` reads `../../package.json` relative to the compiled module. Both `index.ts` and `http-client.ts` must import from it; never hardcode `reqstorm/0.2.0`.
- **`contract-check`**: `SwaggerParser.validate(url)` can throw `Unable to resolve $ref pointer` for specs served from the target server; `loadSpecFallback` fetches the raw spec (JSON/YAML) and parses it instead. A **returned 401/403 status** marks the endpoint `skipped (auth required)` — not just thrown auth errors. **Mutating methods (POST/PUT/PATCH/DELETE) are skipped by default** unless `includeMutatingMethods: true` — probing them is destructive. Response-schema checks target the picked success status (`pickStatusForRequest`), not hardcoded 200.
- **`profile`** builds latency buckets from the real hdr-histogram recorded values (`result.latency.recordedValuesIterator`), not the 4 percentile points. `Avg Response Size` was removed — autocannon's `requests.sent` is sent-request bytes, not response size, and was unreliable.
- **`soak`** measures real `process.memoryUsage()` heap/RSS per snapshot; `memoryTrend` is derived from actual memory growth (>15%), not throughput/error heuristics.
- **`smoke.responseTime`** is the mean latency histogram value, not the total test duration.
- **`validate`** resets errors per retry attempt (no stale timeout failures across retries).

## Deployment

- Publish: `npm run build && npm publish`. `prepublishOnly` runs `build`.
- Package ships only `dist/`, `README.md`, `LICENSE` (see `files` in package.json).
- Users run via MCP host config: `{ "command": "npx", "args": ["-y", "reqstorm"] }`.
- Dependencies bundled: `jsonpath-plus` (JSONPath eval) and `@apidevtools/swagger-parser` (OpenAPI loading/validation). Both must stay in `dependencies` (not dev).
