import * as z from "zod/v4";
import { runBenchmarkSplit } from "../utils/autocannon.js";
import { formatCompare } from "../utils/formatters.js";
import type { CompareResult, PhaseResult, BenchmarkResult } from "../utils/types.js";

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
  pipelining: z.number().int().positive().default(1).describe("HTTP pipelining factor"),
  runs: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(1)
    .describe("Number of runs per target for statistical confidence"),
});

interface RunStats {
  p95Values: number[];
  p50Values: number[];
  throughputValues: number[];
  errorRateValues: number[];
  last: PhaseResult;
  baseline: BenchmarkResult;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], meanVal: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - meanVal, 2), 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

async function runTarget(
  args: z.infer<typeof compareSchema>,
  target:
    | z.infer<typeof compareSchema>["baseline"]
    | z.infer<typeof compareSchema>["target"],
  title: string
): Promise<RunStats> {
  const p95Values: number[] = [];
  const p50Values: number[] = [];
  const throughputValues: number[] = [];
  const errorRateValues: number[] = [];
  let last: PhaseResult | undefined;
  let baseline: BenchmarkResult | undefined;

  for (let i = 0; i < args.runs; i++) {
    const result = await runBenchmarkSplit({
      url: target.url,
      method: target.method,
      headers: target.headers,
      body: target.body,
      connections: args.connections,
      duration: args.duration,
      warmUpDuration: args.warmUpDuration * 1000,
      pipelining: args.pipelining,
      title: `${title}-${i + 1}`,
    });
    const steady = result.steadyState ?? result.overall;
    p95Values.push(steady.latency.p95);
    p50Values.push(steady.latency.p50);
    throughputValues.push(steady.throughput);
    errorRateValues.push(steady.errorRate);
    last = steady;
    baseline = result.overall;
  }

  return {
    p95Values,
    p50Values,
    throughputValues,
    errorRateValues,
    last: last!,
    baseline: baseline!,
  };
}

export async function compareHandler(args: z.infer<typeof compareSchema>) {
  args = compareSchema.parse(args);
  try {
    const [baselineStats, targetStats] = await Promise.all([
      runTarget(args, args.baseline, "reqstorm-compare-baseline"),
      runTarget(args, args.target, "reqstorm-compare-target"),
    ]);

    const b = baselineStats.last;
    const t = targetStats.last;

    const meanP95b = mean(baselineStats.p95Values);
    const meanP95t = mean(targetStats.p95Values);
    const sdP95b = args.runs > 1 ? stddev(baselineStats.p95Values, meanP95b) : 0;
    const sdP95t = args.runs > 1 ? stddev(targetStats.p95Values, meanP95t) : 0;

    const delta = (a: number, bv: number) =>
      bv > 0 ? ((a - bv) / bv) * 100 : 0;

    const p50Delta = delta(mean(targetStats.p50Values), mean(baselineStats.p50Values));
    const p95Delta = delta(meanP95t, meanP95b);
    const p99Delta = delta(t.latency.p99, b.latency.p99);
    const throughputDelta = delta(
      mean(targetStats.throughputValues),
      mean(baselineStats.throughputValues)
    );
    const errorDelta = delta(
      mean(targetStats.errorRateValues),
      mean(baselineStats.errorRateValues)
    );

    let verdict = "";
    let confidence: number | null = null;
    const meanErrorT = mean(targetStats.errorRateValues);
    const meanErrorB = mean(baselineStats.errorRateValues);

    if (p95Delta < -5 && meanErrorT <= meanErrorB) {
      verdict = "Target is FASTER than baseline";
    } else if (p95Delta > 5 && meanErrorT >= meanErrorB) {
      verdict = "Target is SLOWER than baseline";
    } else if (Math.abs(p95Delta) <= 5 && Math.abs(errorDelta) <= 1) {
      verdict = "Performance is SIMILAR";
    } else {
      verdict = "Mixed results — see detailed metrics above";
    }

    if (args.runs > 1 && sdP95b > 0) {
      const combinedSd = Math.sqrt(
        Math.pow(sdP95b, 2) / baselineStats.p95Values.length +
          Math.pow(sdP95t, 2) / targetStats.p95Values.length
      );
      const diff = meanP95t - meanP95b;
      if (combinedSd > 0) {
        const z = Math.abs(diff) / combinedSd;
        confidence = Math.min(99, Math.round((1 - 2 * (1 - normalCdf(z))) * 100));
      }
    }

    const result: CompareResult = {
      baseline: {
        title: "baseline",
        url: args.baseline.url,
        method: (args.baseline.method ?? "GET").toUpperCase(),
        duration: b.duration,
        connections: args.connections,
        pipelining: args.pipelining,
        totalRequests: b.totalRequests,
        totalErrors: b.totalErrors,
        errorRate: meanErrorB,
        throughput: mean(baselineStats.throughputValues),
        latency: b.latency,
      },
      target: {
        title: "target",
        url: args.target.url,
        method: (args.target.method ?? "GET").toUpperCase(),
        duration: t.duration,
        connections: args.connections,
        pipelining: args.pipelining,
        totalRequests: t.totalRequests,
        totalErrors: t.totalErrors,
        errorRate: meanErrorT,
        throughput: mean(targetStats.throughputValues),
        latency: t.latency,
      },
      deltas: {
        p50: p50Delta,
        p95: p95Delta,
        p99: p99Delta,
        throughput: throughputDelta,
        errorRate: errorDelta,
      },
      verdict,
      runs: args.runs,
      confidence,
      meanP95Baseline: meanP95b,
      meanP95Target: meanP95t,
      sdP95Baseline: sdP95b,
      sdP95Target: sdP95t,
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

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d =
    0.3989423 *
    Math.exp((-z * z) / 2) *
    (0.3193815 * t -
      0.3565638 * Math.pow(t, 2) +
      1.781478 * Math.pow(t, 3) -
      1.821256 * Math.pow(t, 4) +
      1.330274 * Math.pow(t, 5));
  if (z > 0) return 1 - d;
  return d;
}
