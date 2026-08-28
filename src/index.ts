#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { benchmarkSchema, benchmarkHandler } from "./tools/benchmark.js";
import { smokeSchema, smokeHandler } from "./tools/smoke.js";
import { loadTestSchema, loadTestHandler } from "./tools/load-test.js";
import { spikeSchema, spikeHandler } from "./tools/spike.js";
import { soakSchema, soakHandler } from "./tools/soak.js";
import { stressTestSchema, stressTestHandler } from "./tools/stress-test.js";
import { compareSchema, compareHandler } from "./tools/compare.js";

serveStdio(() => {
  const server = new McpServer({
    name: "reqstorm",
    version: "0.1.0",
  });

  server.registerTool(
    "benchmark",
    {
      description:
        "Quick performance benchmark of an API endpoint. Returns latency percentiles (p50/p95/p99/p999), throughput (req/s), and splits results into warm-up vs steady-state phases.",
      inputSchema: benchmarkSchema,
    },
    benchmarkHandler
  );

  server.registerTool(
    "smoke",
    {
      description:
        "Fast sanity check (~5s). Validates that an endpoint responds correctly with expected status code and body, with basic latency stats.",
      inputSchema: smokeSchema,
    },
    smokeHandler
  );

  server.registerTool(
    "load-test",
    {
      description:
        "Sustained load test with configurable pass/fail thresholds (maxP95, maxP99, maxErrorRate). Evaluates thresholds against steady-state results only.",
      inputSchema: loadTestSchema,
    },
    loadTestHandler
  );

  server.registerTool(
    "spike",
    {
      description:
        "Sudden traffic surge test. Runs baseline → spike → recovery phases and measures how quickly the system recovers to baseline latency.",
      inputSchema: spikeSchema,
    },
    spikeHandler
  );

  server.registerTool(
    "soak",
    {
      description:
        "Long-running sustained load test (default 30min). Catches memory leaks, connection pool exhaustion, and performance drift over time with periodic snapshots.",
      inputSchema: soakSchema,
    },
    soakHandler
  );

  server.registerTool(
    "stress-test",
    {
      description:
        "Auto-ramp stress test. Gradually increases concurrency from start to max, reporting per-step metrics and identifying the breaking point where latency or error rate degrades.",
      inputSchema: stressTestSchema,
    },
    stressTestHandler
  );

  server.registerTool(
    "compare",
    {
      description:
        "A/B comparison of two endpoints or configurations. Runs both targets in parallel and reports side-by-side deltas for latency, throughput, and error rate.",
      inputSchema: compareSchema,
    },
    compareHandler
  );

  return server;
});
