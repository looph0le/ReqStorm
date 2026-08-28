# ReqStorm

API performance analyzer MCP server. Published to npm as `reqstorm`.

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

## Example

```
benchmark:
  url: "https://api.example.com/users"
  connections: 50
  duration: 30
```

```
load-test:
  url: "https://api.example.com/auth"
  headers: { "Authorization": "Bearer xxx" }
  connections: 100
  thresholds: { "maxP95": 200, "maxErrorRate": 1 }
```

## How results work

Every run reports warm-up vs steady-state separately. Steady-state reflects the API after JIT/cache warming and is used for threshold evaluation, so you can quantify the warm-up effect instead of hiding it.

## Development

```bash
npm run build   # compile src/ → dist/
npm run dev     # tsc --watch
npm publish     # build + ship (requires npm login + 2FA)
```

## License

MIT
