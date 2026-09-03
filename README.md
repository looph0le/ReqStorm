# ReqStorm

[![npm version](https://img.shields.io/npm/v/reqstorm.svg)](https://www.npmjs.com/package/reqstorm)
[![Downloads](https://img.shields.io/npm/dm/reqstorm.svg)](https://www.npmjs.com/package/reqstorm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/looph0le/reqstorm)

API testing and performance analysis MCP server. Published to npm as [`reqstorm`](https://www.npmjs.com/package/reqstorm).

Run API tests from any MCP host (Claude Desktop, VS Code, Cursor, etc.) using **14 tools** covering performance testing, functional validation, API contract checking, security scanning, and more.

## Install

Add to your MCP host config:

```json
{
  "mcpServers": {
    "reqstorm": {
      "command": "npx",
      "args": ["-y", "reqstorm"]
    }
  }
}
```

Or install globally for direct use:

```bash
npm install -g reqstorm
```

## Tools

### Performance Testing

| Tool | Description |
|------|-------------|
| `benchmark` | Quick endpoint benchmark. Latency percentiles (p50/p95/p99/p999), throughput (req/s), warm-up vs steady-state split. |
| `smoke` | Fast sanity check. Validates status code and response body, basic latency stats. |
| `load-test` | Sustained load with pass/fail thresholds (maxP95, maxP99, maxErrorRate). Thresholds evaluated on steady-state only. |
| `spike` | Sudden traffic surge. Measures recovery time back to baseline latency after the spike. |
| `soak` | Long-running sustained load (default 30min). Catches memory leaks and drift over time with periodic snapshots. |
| `stress-test` | Auto-ramp from low to high concurrency. Identifies the breaking point where latency/error degrades. |
| `compare` | A/B comparison of two endpoints with multi-run statistical confidence (mean, stddev, p-value). |

### Functional & Contract Testing

| Tool | Description |
|------|-------------|
| `validate` | Send a request and assert on the response with JSONPath + 12 matcher operators (equals, contains, regex, type, gt, lt, oneOf, etc.). Supports retries. |
| `chain` | Multi-step workflows. Each step's response can be asserted and extract variables (JSONPath) that interpolate into later steps via `{{var}}`. |
| `contract-check` | Validate a running server against an OpenAPI 3.x spec (status codes, schema shape, content types) and detect breaking changes vs a previous spec. |
| `fuzz` | Mutation-based robustness testing. Boundary, type-swap, injection, overflow, unicode, format, null-field, and missing-fields strategies. |
| `regression` | Compare current performance against a saved baseline to detect p95/throughput/error-rate regressions. Baselines persist to `.reqstorm/`. |

### Security Testing

| Tool | Description |
|------|-------------|
| `security-scan` | 8 security checks: security headers, data exposure, rate limiting, IDOR, auth bypass, method override, content-type mismatch, path traversal. |

### Profiling

| Tool | Description |
|------|-------------|
| `profile` | Deep latency profile with a histogram of percentile buckets, throughput coefficient of variation (stability), and status-code distribution. |

All tools accept `headers` for authentication (Bearer tokens, API keys, cookies).

## Usage Examples

**Quick benchmark:**

```
benchmark:
  url: "https://api.example.com/users"
  connections: 50
  duration: 30
```

**Functionally validate a response:**

```
validate:
  url: "https://api.example.com/users/1"
  assertions:
    - path: "$.name"
      match: { op: "equals", expected: "Alice" }
    - path: "$.age"
      match: { op: "gte", expected: 18 }
    - path: "$.email"
      match: { op: "matches", pattern: "^[^@]+@[^@]+$" }
```

**Chain a multi-step flow with variable sharing:**

```
chain:
  baseUrl: "https://api.example.com"
  steps:
    - name: login
      request: { url: "/auth/login", method: "POST" }
      extract: { token: "$.token" }
    - name: create-user
      request:
        url: "/users"
        method: "POST"
        headers: { "Authorization": "Bearer {{token}}" }
        body: "{ \"name\": \"Test User\" }"
      extract: { id: "$.id" }
    - name: verify
      request: { url: "/users/{{id}}", method: "GET" }
      assertions:
        - path: "$.name"
          match: { op: "equals", expected: "Test User" }
```

**Check a live API against its OpenAPI spec:**

```
contract-check:
  specUrl: "https://api.example.com/openapi.json"
  baseUrl: "https://api.example.com"
```

**Load test with SLO thresholds:**

```
load-test:
  url: "https://api.example.com/auth"
  headers: { "Authorization": "Bearer xxx" }
  connections: 100
  duration: 60
  thresholds: { "maxP95": 200, "maxP99": 500, "maxErrorRate": 1 }
```

**Spike test (surge + recovery):**

```
spike:
  url: "https://api.example.com/search"
  baselineConcurrency: 10
  spikeConcurrency: 200
  baselineDuration: 30
  spikeDuration: 15
  recoveryDuration: 30
```

**Find the breaking point:**

```
stress-test:
  url: "https://api.example.com/items"
  startConcurrency: 5
  stepSize: 10
  stepDuration: 20
  maxConcurrency: 500
  breakThreshold: { "maxP95": 1000, "maxErrorRate": 5 }
```

**A/B comparison of two implementations with statistical confidence:**

```
compare:
  baseline: { "url": "https://api-v2.example.com/users" }
  target:   { "url": "https://api-v3.example.com/users" }
  connections: 20
  duration: 30
  runs: 5
```

**Fuzz test an endpoint for robustness:**

```
fuzz:
  url: "https://api.example.com/users"
  method: "POST"
  depth: "normal"
  strategies:
    - boundary
    - injection
    - type-swap
    - missing-fields
  body:
    name: "Alice"
    age: 30
```

**Security scan:**

```
security-scan:
  url: "https://api.example.com/users/1"
  checks:
    - security-headers
    - data-exposure
    - idor
    - path-traversal
```

## How results work

Performance tools report warm-up vs steady-state separately. Steady-state reflects the API after JIT/cache warming and is used for threshold evaluation, so you can quantify the warm-up effect instead of hiding it.

### Latency percentiles

Latency is reported as p50, p95, p99, and p999. Percentiles reveal tail latency that an average hides — a 100ms average can mask 1% of requests taking 5 seconds. Use p95/p99 for SLOs (typically p95 < 300ms for user-facing APIs, p99 < 2s).

### JSONPath & matchers

`validate`, `chain`, and `contract-check` use [JSONPath](https://goessner.net/articles/JsonPath/) (via `jsonpath-plus`):
- `$.name` — field
- `$.users[0].id` — array index
- `$..email` — recursive descent
- `$.tags[*]` — wildcard

Matcher operators: `equals`, `notEquals`, `contains`, `startsWith`, `endsWith`, `matches` (regex), `exists`, `notExists`, `typeOf`, `oneOf`, `gt`, `gte`, `lt`, `lte`.

### Chain variables

Steps can extract values from responses via JSONPath and re-use them in later requests with `{{name}}` interpolation. This enables create → read → update → delete flows.

### Regression baselines

`regression` and `benchmark` (with `saveAs`) persist results to `.reqstorm/` in the working directory. Regression compares the current run against the stored baseline and can fail on p95/throughput/error-rate deviations.

## Development

```bash
npm run build   # compile src/ → dist/
npm run dev     # tsc --watch
npm publish     # build + ship (requires npm login + 2FA)
```

## License

MIT
