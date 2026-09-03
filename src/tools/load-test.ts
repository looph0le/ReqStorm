import * as z from "zod/v4";
import { runBenchmarkSplit } from "../utils/autocannon.js";
import { formatLoadTest } from "../utils/formatters.js";
import type { ThresholdResult } from "../utils/types.js";

export const loadTestSchema = z.object({
  url: z.string().describe("Target URL to load test"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Request body"),
  connections: z.number().int().positive().default(10).describe("Number of concurrent connections"),
  duration: z.number().int().positive().default(30).describe("Test duration in seconds"),
  pipelining: z.number().int().positive().default(1).describe("HTTP pipelining factor"),
  warmUpDuration: z.number().nonnegative().default(3).describe("Warm-up period in seconds"),
  thresholds: z
    .object({
      maxP95: z.number().nonnegative().optional().describe("Max acceptable p95 latency in ms"),
      maxP99: z.number().nonnegative().optional().describe("Max acceptable p99 latency in ms"),
      maxErrorRate: z.number().min(0).max(100).optional().describe("Max acceptable error rate (0-100%)"),
    })
    .default({})
    .describe("Pass/fail thresholds"),
});

export async function loadTestHandler(args: z.infer<typeof loadTestSchema>) {
  args = loadTestSchema.parse(args);
  const result = await runBenchmarkSplit({
    url: args.url,
    method: args.method,
    headers: args.headers,
    body: args.body,
    connections: args.connections,
    duration: args.duration,
    pipelining: args.pipelining,
    warmUpDuration: args.warmUpDuration * 1000,
    title: "reqstorm-load-test",
  });

  const steadyLatency = result.steadyState?.latency ?? result.overall.latency;
  const steadyErrorRate = result.steadyState?.errorRate ?? result.overall.errorRate;

  const thresholds: ThresholdResult[] = [];
  if (args.thresholds.maxP95 !== undefined) {
    thresholds.push({
      name: "p95 latency",
      threshold: args.thresholds.maxP95,
      actual: steadyLatency.p95,
      passed: steadyLatency.p95 <= args.thresholds.maxP95,
    });
  }
  if (args.thresholds.maxP99 !== undefined) {
    thresholds.push({
      name: "p99 latency",
      threshold: args.thresholds.maxP99,
      actual: steadyLatency.p99,
      passed: steadyLatency.p99 <= args.thresholds.maxP99,
    });
  }
  if (args.thresholds.maxErrorRate !== undefined) {
    thresholds.push({
      name: "error rate",
      threshold: args.thresholds.maxErrorRate,
      actual: steadyErrorRate,
      passed: steadyErrorRate <= args.thresholds.maxErrorRate,
    });
  }

  const passed = thresholds.length === 0 || thresholds.every((t) => t.passed);

  const loadResult = {
    ...result.overall,
    thresholds,
    passed,
  };

  return {
    content: [{ type: "text" as const, text: formatLoadTest(loadResult as any) }],
  };
}
