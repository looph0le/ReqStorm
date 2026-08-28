# ReqStorm

[![npm version](https://img.shields.io/npm/v/reqstorm.svg)](https://www.npmjs.com/package/reqstorm)
[![Downloads](https://img.shields.io/npm/dm/reqstorm.svg)](https://www.npmjs.com/package/reqstorm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

API performance analyzer MCP server. Published to npm as [`reqstorm`](https://www.npmjs.com/package/reqstorm).

Run API performance tests from any MCP host (Claude Desktop, VS Code, Cursor, etc.) using 7 tools covering benchmarking, load testing, stress testing, spike testing, soak testing, smoke testing, and A/B comparison.

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

| Tool | Description |
|------|-------------|
| `benchmark` | Quick endpoint benchmark. Latency percentiles (p50/p95/p99/p999), throughput (req/s), warm-up vs steady-state split. |
| `smoke` | Fast sanity check (~5s). Validates status code and response body, basic latency stats. |
| `load-test` | Sustained load with pass/fail thresholds (maxP95, maxP99, maxErrorRate). Thresholds evaluated on steady-state only. |
| `spike` | Sudden traffic surge. Measures recovery time back to baseline latency after the spike. |
| `soak` | Long-running sustained load (default 30min). Catches memory leaks and drift over time with periodic snapshots. |
| `stress-test` | Auto-ramp from low to high concurrency. Identifies the breaking point where latency/error degrades. |
| `compare` | A/B comparison of two endpoints. Side-by-side deltas for latency, throughput, error rate. |

All tools accept `headers` for authentication (Bearer tokens, API keys, cookies).

## Usage Examples

**Quick benchmark:**

```
benchmark:
  url: "https://api.example.com/users"
  connections: 50
  duration: 30
```

**Smoke test with response validation:**

```
smoke:
  url: "https://api.example.com/health"
  expectedStatus: 200
  expectedBody: "ok"
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

**A/B comparison of two implementations:**

```
compare:
  baseline: { "url": "https://api-v2.example.com/users" }
  target:   { "url": "https://api-v3.example.com/users" }
  connections: 20
  duration: 30
```

## How results work

Every run reports warm-up vs steady-state separately. Steady-state reflects the API after JIT/cache warming and is used for threshold evaluation, so you can quantify the warm-up effect instead of hiding it.

### Latency percentiles

Latency is reported as p50, p95, p99, and p999. Percentiles reveal tail latency that an average hides — a 100ms average can mask 1% of requests taking 5 seconds. Use p95/p99 for SLOs (typically p95 < 300ms for user-facing APIs, p99 < 2s).

## Development

```bash
npm run build   # compile src/ → dist/
npm run dev     # tsc --watch
npm publish     # build + ship (requires npm login + 2FA)
```

## License

MIT
