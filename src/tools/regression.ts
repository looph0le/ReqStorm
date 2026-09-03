import * as z from "zod/v4";
import { runBenchmarkSplit } from "../utils/autocannon.js";
import { loadBaseline, saveResult } from "../utils/persistence.js";
import type { RegressionResult } from "../utils/types.js";

export const regressionSchema = z.object({
  url: z.string().describe("Target URL"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Request body"),
  connections: z.number().int().positive().default(10),
  duration: z.number().int().positive().default(10),
  warmUpDuration: z.number().nonnegative().default(3),
  pipelining: z.number().int().positive().default(1),
  baselineName: z
    .string()
    .default("default")
    .describe("Name for the baseline snapshot"),
  saveResult: z
    .boolean()
    .default(true)
    .describe("Save this run as the new baseline"),
  thresholds: z
    .object({
      maxP95Regression: z
        .number()
        .default(20)
        .describe("Max allowed p95 increase (%)"),
      maxErrorRateIncrease: z
        .number()
        .default(5)
        .describe("Max allowed error rate increase (percentage points)"),
      maxThroughputDrop: z
        .number()
        .default(15)
        .describe("Max allowed throughput decrease (%)"),
    })
    .partial()
    .default(() => ({}))
    .describe("Regression thresholds"),
});

export async function regressionHandler(
  args: z.infer<typeof regressionSchema>
) {
  args = regressionSchema.parse(args);
  try {
    const run = await runBenchmarkSplit({
      url: args.url,
      method: args.method,
      headers: args.headers,
      body: args.body,
      connections: args.connections,
      duration: args.duration,
      warmUpDuration: args.warmUpDuration * 1000,
      pipelining: args.pipelining,
      title: "reqstorm-regression",
    });

    const current = run.steadyState ?? run.overall;
    const previous = loadBaseline(args.baselineName);

    const deltaPct = (cur: number, prev: number) =>
      prev > 0 ? ((cur - prev) / prev) * 100 : 0;
    const deltaPts = (cur: number, prev: number) =>
      prev !== undefined ? cur - prev : 0;

    const baselineLatency = previous?.data as
      | { latency?: { p95: number; p99: number }; throughput?: number; errorRate?: number }
      | undefined;

    let baselineTimestamp: string | null = previous?.timestamp ?? null;
    const p95Baseline = baselineLatency?.latency?.p95;
    const p99Baseline = baselineLatency?.latency?.p99;
    const throughputBaseline = baselineLatency?.throughput;
    const errorRateBaseline = baselineLatency?.errorRate;

    const deltas = {
      p95: {
        current: current.latency.p95,
        baseline: p95Baseline ?? current.latency.p95,
        changePct: p95Baseline !== undefined ? deltaPct(current.latency.p95, p95Baseline) : 0,
      },
      p99: {
        current: current.latency.p99,
        baseline: p99Baseline ?? current.latency.p99,
        changePct: p99Baseline !== undefined ? deltaPct(current.latency.p99, p99Baseline) : 0,
      },
      throughput: {
        current: current.throughput,
        baseline: throughputBaseline ?? current.throughput,
        changePct: throughputBaseline !== undefined ? deltaPct(current.throughput, throughputBaseline) : 0,
      },
      errorRate: {
        current: current.errorRate,
        baseline: errorRateBaseline ?? current.errorRate,
        changePct: errorRateBaseline !== undefined ? deltaPct(current.errorRate, errorRateBaseline) : 0,
      },
    };

    const thresholdsChecked: RegressionResult["thresholdsChecked"] = [];
    if (args.thresholds.maxP95Regression !== undefined && p95Baseline !== undefined) {
      thresholdsChecked.push({
        name: "p95 regression",
        threshold: args.thresholds.maxP95Regression,
        actual: deltas.p95.changePct,
        passed: deltas.p95.changePct <= args.thresholds.maxP95Regression,
      });
    }
    if (args.thresholds.maxErrorRateIncrease !== undefined && errorRateBaseline !== undefined) {
      thresholdsChecked.push({
        name: "error rate increase",
        threshold: args.thresholds.maxErrorRateIncrease,
        actual: deltaPts(current.errorRate, errorRateBaseline),
        passed: deltaPts(current.errorRate, errorRateBaseline) <= args.thresholds.maxErrorRateIncrease,
      });
    }
    if (args.thresholds.maxThroughputDrop !== undefined && throughputBaseline !== undefined) {
      thresholdsChecked.push({
        name: "throughput drop",
        threshold: args.thresholds.maxThroughputDrop,
        actual: -deltas.throughput.changePct,
        passed: -deltas.throughput.changePct <= args.thresholds.maxThroughputDrop,
      });
    }

    const passed = thresholdsChecked.length === 0 || thresholdsChecked.every((t) => t.passed);

    let baselineUpdated = false;
    if (args.saveResult) {
      saveResult(
        args.baselineName,
        "benchmark",
        {
          url: args.url,
          method: (args.method ?? "GET").toUpperCase(),
          latency: current.latency,
          throughput: current.throughput,
          errorRate: current.errorRate,
          duration: current.duration,
        }
      );
      baselineUpdated = true;
    }

    const result: RegressionResult = {
      url: args.url,
      method: (args.method ?? "GET").toUpperCase(),
      deltas,
      thresholdsChecked,
      passed,
      baselineTimestamp,
      baselineUpdated,
    };

    return {
      content: [{ type: "text" as const, text: formatRegression(result) }],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Regression test failed: ${err.message ?? err}`,
        },
      ],
      isError: true,
    };
  }
}

function formatRegression(result: RegressionResult): string {
  const SE = "═".repeat(50);
  const lines = [
    "",
    SE,
    `  Regression: ${result.method} ${result.url}`,
    SE,
    "",
  ];

  if (result.baselineTimestamp) {
    lines.push(`  Baseline:      ${result.baselineTimestamp}`);
  } else {
    lines.push(`  Baseline:      none (first run)`);
  }
  lines.push("");

  lines.push(
    `  p95:          ${result.deltas.p95.current.toFixed(1)}ms (baseline ${result.deltas.p95.baseline.toFixed(1)}ms) ${result.deltas.p95.changePct.toFixed(1)}%`
  );
  lines.push(
    `  p99:          ${result.deltas.p99.current.toFixed(1)}ms (baseline ${result.deltas.p99.baseline.toFixed(1)}ms) ${result.deltas.p99.changePct.toFixed(1)}%`
  );
  lines.push(
    `  Throughput:   ${Math.round(result.deltas.throughput.current)} req/s (baseline ${Math.round(result.deltas.throughput.baseline)} req/s) ${result.deltas.throughput.changePct.toFixed(1)}%`
  );
  lines.push(
    `  Error Rate:   ${result.deltas.errorRate.current.toFixed(2)}% (baseline ${result.deltas.errorRate.baseline.toFixed(2)}%) ${result.deltas.errorRate.changePct.toFixed(1)}%`
  );
  lines.push("");

  if (result.thresholdsChecked.length > 0) {
    lines.push("  Thresholds:");
    for (const t of result.thresholdsChecked) {
      lines.push(
        `    ${t.name}: ${t.actual.toFixed(2)} (limit: ${t.threshold}) → ${t.passed ? "PASS" : "FAIL"}`
      );
    }
    lines.push("");
  }

  lines.push(`  Result:        ${result.passed ? "NO REGRESSION" : "REGRESSION DETECTED"}`);
  if (result.baselineUpdated && result.baselineTimestamp) {
    lines.push(`  Baseline updated.`);
  } else if (result.baselineUpdated) {
    lines.push(`  Baseline saved (first run).`);
  }
  lines.push("");
  return lines.join("\n");
}
