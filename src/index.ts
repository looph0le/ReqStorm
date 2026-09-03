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
import { validateSchema, validateHandler } from "./tools/validate.js";
import { chainSchema, chainHandler } from "./tools/chain.js";
import { contractCheckSchema, contractCheckHandler } from "./tools/contract-check.js";
import { fuzzSchema, fuzzHandler } from "./tools/fuzz.js";
import { profileSchema, profileHandler } from "./tools/profile.js";
import { securityScanSchema, securityScanHandler } from "./tools/security-scan.js";
import { regressionSchema, regressionHandler } from "./tools/regression.js";

serveStdio(() => {
  const server = new McpServer({
    name: "reqstorm",
    version: "0.2.0",
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
        "A/B comparison of two endpoints or configurations. Runs both targets in parallel and reports side-by-side deltas for latency, throughput, and error rate. Supports multi-run statistical confidence.",
      inputSchema: compareSchema,
    },
    compareHandler
  );

  server.registerTool(
    "validate",
    {
      description:
        "Functional assertion testing. Sends a single request and evaluates JSONPath-based assertions against the response body, with optional response-time and retry thresholds.",
      inputSchema: validateSchema,
    },
    validateHandler
  );

  server.registerTool(
    "chain",
    {
      description:
        "Multi-step workflow testing. Runs a sequence of requests, extracting variables between steps and asserting on responses. Supports CRUD workflows, auth flows, and stateful API interactions.",
      inputSchema: chainSchema,
    },
    chainHandler
  );

  server.registerTool(
    "contract-check",
    {
      description:
        "OpenAPI spec conformance testing. Validates a live server against an OpenAPI 3.x spec: status codes, response schemas, content types. Optional previous-spec diff detects breaking changes and schema drift.",
      inputSchema: contractCheckSchema,
    },
    contractCheckHandler
  );

  server.registerTool(
    "fuzz",
    {
      description:
        "Intelligent fuzzing. Mutates a base request body using boundary, type-swap, injection, overflow, unicode, and other strategies to discover failure modes, crashes, and unexpected behavior.",
      inputSchema: fuzzSchema,
    },
    fuzzHandler
  );

  server.registerTool(
    "profile",
    {
      description:
        "Response-time profiling. Runs a load test and breaks down latency into a distribution histogram, per-status-code counts, throughput stability (CV), and error/timeout breakdowns.",
      inputSchema: profileSchema,
    },
    profileHandler
  );

  server.registerTool(
    "security-scan",
    {
      description:
        "Lightweight security testing. Probes an endpoint for auth bypass, IDOR, missing security headers, sensitive data exposure, rate limiting, and method/content-type overrides.",
      inputSchema: securityScanSchema,
    },
    securityScanHandler
  );

  server.registerTool(
    "regression",
    {
      description:
        "Performance regression detection. Runs a benchmark, compares against a stored baseline in .reqstorm/, and reports whether metrics regressed beyond configurable thresholds. Optionally saves the run as the new baseline.",
      inputSchema: regressionSchema,
    },
    regressionHandler
  );

  return server;
});
