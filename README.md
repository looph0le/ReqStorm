<p align="center">
  <img src="docs/reqstorm-icon.svg" alt="ReqStorm logo" width="220" />
</p>

<h1 align="center">ReqStorm</h1>

[![npm version](https://img.shields.io/npm/v/reqstorm.svg)](https://www.npmjs.com/package/reqstorm)
[![Downloads](https://img.shields.io/npm/dm/reqstorm.svg)](https://www.npmjs.com/package/reqstorm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/looph0le/reqstorm)

ReqStorm is an [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for API testing, performance analysis, contract validation, fuzzing, and lightweight security checks. It runs over stdio, so it works with MCP clients such as Claude Desktop, VS Code, Cursor, and other compatible hosts.

ReqStorm is published as [`reqstorm`](https://www.npmjs.com/package/reqstorm) and provides 14 tools:

- **Performance:** benchmark, smoke, load-test, spike, soak, stress-test, compare
- **Functional and contract:** validate, chain, contract-check, fuzz, regression
- **Security and profiling:** security-scan, profile

## Quick start

Add ReqStorm to your MCP host configuration:

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

The first run downloads the package from npm. For a globally installed binary instead:

```bash
npm install --global reqstorm
```

Then ask your MCP client to run a tool, for example:

> Run a ReqStorm benchmark against `https://api.example.com/health` with 10 connections for 10 seconds.

ReqStorm needs **Node.js 18 or newer**.

## Tool reference

### Performance testing

| Tool          | Use it for                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `benchmark`   | Measure throughput and p50/p95/p99/p999 latency. Results include overall, warm-up, and steady-state data.                          |
| `smoke`       | Quickly check that an endpoint responds with the expected status and body.                                                         |
| `load-test`   | Run sustained traffic and evaluate steady-state `maxP95`, `maxP99`, and `maxErrorRate` thresholds.                                 |
| `spike`       | Run baseline, sudden surge, and recovery phases; measure recovery against baseline latency.                                        |
| `soak`        | Run long-lived traffic in periodic chunks to find memory leaks, exhaustion, and performance drift. Default duration is 30 minutes. |
| `stress-test` | Ramp concurrency step by step until latency or error-rate thresholds identify a breaking point.                                    |
| `compare`     | Compare two endpoints or configurations side by side, optionally repeating each target up to five times.                           |

### Functional and contract testing

| Tool             | Use it for                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `validate`       | Send one request and assert on JSONPath values, types, comparisons, regexes, array properties, and response-time thresholds.        |
| `chain`          | Execute up to 20 ordered requests, extract values from responses, interpolate them into later requests, and assert each step.       |
| `contract-check` | Check a running API against an OpenAPI 3.x JSON/YAML document, including status codes, schemas, content types, and required fields. |
| `fuzz`           | Mutate request bodies with boundary, type-swap, injection, overflow, missing-field, Unicode, format, and null-field strategies.     |
| `regression`     | Compare steady-state performance with a saved `.reqstorm/` baseline and optionally save the current run as the new baseline.        |

### Security and profiling

| Tool            | Use it for                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `security-scan` | Run selected checks for authentication bypass, IDOR, security headers, data exposure, rate limiting, method override, content-type mismatch, and path traversal. |
| `profile`       | Inspect latency distribution, status-code counts, throughput stability, and error/timeout breakdowns.                                                            |

## Common input conventions

- `url` values must be reachable by the machine running the MCP server.
- `headers` is a string-to-string object and can carry authentication, cookies, or API keys.
- HTTP `body` fields are JSON strings, not JavaScript objects. Set an appropriate `Content-Type` header when sending JSON.
- Methods that use JSONPath accept expressions such as `$.user.id`, `$.items[0]`, `$..email`, and `$.tags[*]`.
- Outputs are returned as formatted text in the MCP tool response.
- Performance tools use the steady-state phase for threshold evaluation; warm-up results are still reported rather than discarded.

## Examples

### Benchmark an endpoint

```json
{
  "url": "https://api.example.com/users",
  "connections": 50,
  "duration": 30,
  "warmUpDuration": 5,
  "headers": {
    "Authorization": "Bearer <token>"
  }
}
```

### Validate a JSON response

```json
{
  "url": "https://api.example.com/users/1",
  "assertions": [
    {
      "path": "$.name",
      "match": { "op": "equals", "expected": "Alice" }
    },
    {
      "path": "$.age",
      "match": { "op": "gte", "expected": 18 }
    },
    {
      "path": "$.email",
      "match": { "op": "matches", "pattern": "^[^@]+@[^@]+$" }
    }
  ],
  "timeouts": {
    "maxResponseMs": 500
  },
  "retries": 2
}
```

Supported matcher operators are `equals`, `notEquals`, `contains`, `matches`, `gt`, `lt`, `gte`, `lte`, `exists`, `notExists`, `isType`, `isArray`, and `hasLength`.

### Chain an authenticated workflow

```json
{
  "baseUrl": "https://api.example.com",
  "steps": [
    {
      "name": "login",
      "request": {
        "url": "/auth/login",
        "method": "POST",
        "headers": { "Content-Type": "application/json" },
        "body": "{\"username\":\"test\",\"password\":\"<password>\"}"
      },
      "extract": { "token": "$.token" }
    },
    {
      "name": "create-user",
      "request": {
        "url": "/users",
        "method": "POST",
        "headers": {
          "Authorization": "Bearer {{token}}",
          "Content-Type": "application/json"
        },
        "body": "{\"name\":\"Test User\"}"
      },
      "extract": { "id": "$.id" }
    },
    {
      "name": "verify",
      "request": {
        "url": "/users/{{id}}",
        "headers": { "Authorization": "Bearer {{token}}" }
      },
      "assertions": [
        {
          "path": "$.name",
          "match": { "op": "equals", "expected": "Test User" }
        }
      ]
    }
  ]
}
```

### Check an OpenAPI contract

```json
{
  "specUrl": "https://api.example.com/openapi.json",
  "baseUrl": "https://api.example.com",
  "headers": {
    "Authorization": "Bearer <token>"
  },
  "paths": ["/users"],
  "methods": ["get", "post"],
  "previousSpecUrl": "/absolute/path/to/previous-openapi.yaml"
}
```

`specUrl` can be an HTTP(S) URL, an absolute file path, a `file://` path, or an inline JSON document.

### Load test with thresholds

```json
{
  "url": "https://api.example.com/auth",
  "connections": 100,
  "duration": 60,
  "headers": {
    "Authorization": "Bearer <token>"
  },
  "thresholds": {
    "maxP95": 200,
    "maxP99": 500,
    "maxErrorRate": 1
  }
}
```

### Fuzz a JSON request body

Use `body` for a JSON string, or `bodyTemplate` when calling the tool with a structured object:

```json
{
  "url": "https://api.example.com/users",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer <token>"
  },
  "bodyTemplate": {
    "name": "Alice",
    "age": 30
  },
  "depth": "normal",
  "strategies": ["boundary", "injection", "type-swap", "missing-fields"]
}
```

The `depth` setting controls the mutation intensity: `quick`, `normal` (default), or `thorough`. By default, a baseline request is sent first and statuses `500`, `502`, `503`, and `504` are treated as hard failures.

### Run a security scan

```json
{
  "url": "https://api.example.com/users/123",
  "headers": {
    "Authorization": "Bearer <token>"
  },
  "authToken": "<token>",
  "resourceId": "123",
  "checks": ["auth-bypass", "security-headers", "data-exposure", "idor", "path-traversal"]
}
```

Only scan systems you own or are authorized to test. Security checks and fuzzing send additional requests and may change data when pointed at state-changing endpoints.

## Results and baselines

### Latency

Performance results report p50, p95, p99, and p999 latency, plus throughput and error rate. Tail percentiles are more useful than averages for SLOs: an average can look healthy while a small percentage of requests are very slow.

### Warm-up and steady state

Benchmark-based tools split the run into warm-up and steady-state phases. Warm-up is retained in the output, while load-test and other threshold checks use steady-state metrics so cache and JIT warm-up do not distort pass/fail results.

### Regression baselines

`benchmark` can save a result with `saveAs`; `regression` reads and writes named baselines in `.reqstorm/`. Keep this directory with the project or CI workspace when comparing runs across executions.

## Development

```bash
npm install
npm run build   # compile src/ to dist/
npm run dev     # watch TypeScript changes
```

To publish a release:

```bash
npm run build
npm publish
```

`prepublishOnly` runs the build automatically. The package requires npm authentication and the published package contains `dist/`, `README.md`, and `LICENSE`.

## License

MIT
