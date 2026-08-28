import * as z from "zod/v4";
import { runBenchmarkSplit } from "../utils/autocannon.js";
import { formatCompare } from "../utils/formatters.js";
import type { CompareResult } from "../utils/types.js";

export const compareSchema = z.object({
  baseline: z
    .object({
      url: z.string().describe("Baseline URL"),
      method: z.string().default("GET").describe("HTTP method"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Request headers"),
      body: z.string().optional().describe("Request body"),
    })
    .describe("Baseline endpoint configuration"),
  target: z
    .object({
      url: z.string().describe("Target URL"),
      method: z.string().default("GET").describe("HTTP method"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Request headers"),
      body: z.string().optional().describe("Request body"),
    })
    .describe("Target endpoint configuration"),
  connections: z.number().int().positive().default(10).describe("Concurrent connections"),
  duration: z.number().int().positive().default(10).describe("Duration per target in seconds"),
  warmUpDuration: z.number().nonnegative().default(3).describe("Warm-up period in seconds"),
});

export async function compareHandler(args: z.infer<typeof compareSchema>) {
  try {
    const [baselineResult, targetResult] = await Promise.all([
      runBenchmarkSplit({
        url: args.baseline.url,
        method: args.baseline.method,
        headers: args.baseline.headers,
        body: args.baseline.body,
        connections: args.connections,
        duration: args.duration,
        warmUpDuration: args.warmUpDuration * 1000,
        title: "reqstorm-compare-baseline",
      }),
      runBenchmarkSplit({
        url: args.target.url,
        method: args.target.method,
        headers: args.target.headers,
        body: args.target.body,
        connections: args.connections,
        duration: args.duration,
        warmUpDuration: args.warmUpDuration * 1000,
        title: "reqstorm-compare-target",
      }),
    ]);

    const b = baselineResult.steadyState;
    const t = targetResult.steadyState;

    const delta = (a: number, bv: number) =>
      bv > 0 ? ((a - bv) / bv) * 100 : 0;

    const p50Delta = delta(t.latency.p50, b.latency.p50);
    const p95Delta = delta(t.latency.p95, b.latency.p95);
    const p99Delta = delta(t.latency.p99, b.latency.p99);
    const throughputDelta = delta(t.throughput, b.throughput);
    const errorDelta = delta(t.errorRate, b.errorRate);

    let verdict = "";
    if (p95Delta < -5 && t.errorRate <= b.errorRate) {
      verdict = "Target is FASTER than baseline";
    } else if (p95Delta > 5 && t.errorRate >= b.errorRate) {
      verdict = "Target is SLOWER than baseline";
    } else if (Math.abs(p95Delta) <= 5 && Math.abs(errorDelta) <= 1) {
      verdict = "Performance is SIMILAR";
    } else {
      verdict = "Mixed results — see detailed metrics above";
    }

    const result: CompareResult = {
      baseline: {
        title: "baseline",
        url: args.baseline.url,
        method: (args.baseline.method ?? "GET").toUpperCase(),
        duration: b.duration,
        connections: args.connections,
        pipelining: 1,
        totalRequests: b.totalRequests,
        totalErrors: b.totalErrors,
        errorRate: b.errorRate,
        throughput: b.throughput,
        latency: b.latency,
        ttfb: b.ttfb,
      },
      target: {
        title: "target",
        url: args.target.url,
        method: (args.target.method ?? "GET").toUpperCase(),
        duration: t.duration,
        connections: args.connections,
        pipelining: 1,
        totalRequests: t.totalRequests,
        totalErrors: t.totalErrors,
        errorRate: t.errorRate,
        throughput: t.throughput,
        latency: t.latency,
        ttfb: t.ttfb,
      },
      deltas: {
        p50: p50Delta,
        p95: p95Delta,
        p99: p99Delta,
        throughput: throughputDelta,
        errorRate: errorDelta,
      },
      verdict,
    };

    return {
      content: [{ type: "text" as const, text: formatCompare(result) }],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Compare test failed: ${err.message ?? err}`,
        },
      ],
      isError: true,
    };
  }
}
