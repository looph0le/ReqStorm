import autocannon from "autocannon";
import type {
  BenchmarkResult,
  LatencyPercentiles,
  PhaseResult,
} from "./types.js";

export interface RunOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  connections?: number;
  duration?: number;
  pipelining?: number;
  warmUpDuration?: number | null;
  title?: string;
}

interface SplitResult {
  warmUp: PhaseResult | null;
  steadyState: PhaseResult;
  overall: BenchmarkResult;
}

function extractLatency(result: autocannon.Result): LatencyPercentiles {
  return {
    p50: result.latency.p50,
    p95: result.latency.p97_5,
    p99: result.latency.p99,
    p999: result.latency.p99_9,
  };
}

function extractTtfb(_result: autocannon.Result): LatencyPercentiles {
  return { p50: 0, p95: 0, p99: 0, p999: 0 };
}

function buildPhaseResult(
  label: string,
  duration: number,
  result: autocannon.Result
): PhaseResult {
  const totalRequests = result.requests.total;
  const totalErrors = result.errors;
  const errorRate =
    totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  return {
    label,
    duration,
    totalRequests,
    totalErrors,
    errorRate,
    throughput: result.requests.average,
    latency: extractLatency(result),
    ttfb: extractTtfb(result),
  };
}

export async function runBenchmark(opts: RunOptions): Promise<BenchmarkResult> {
  const result = await executeAutocannon(opts);
  return buildBenchmarkResult(opts, result, null, null);
}

export async function runBenchmarkSplit(
  opts: RunOptions
): Promise<SplitResult> {
  const warmUpMs = opts.warmUpDuration ?? 3000;
  const totalDuration = opts.duration ?? 10;

  if (warmUpMs <= 0 || warmUpMs >= totalDuration * 1000) {
    const result = await executeAutocannon(opts);
    const overall = buildBenchmarkResult(opts, result, null, null);
    const steadyState = buildPhaseResult("Steady-State", overall.duration, result);
    return { warmUp: null, steadyState, overall };
  }

  const warmUpResult = await executeAutocannon({
    ...opts,
    duration: Math.ceil(warmUpMs / 1000),
    title: `${opts.title ?? "reqstorm"}-warmup`,
  });

  const warmUp = buildPhaseResult(
    "Warm-up",
    Math.ceil(warmUpMs / 1000),
    warmUpResult
  );

  const steadyDuration = totalDuration - Math.ceil(warmUpMs / 1000);
  const steadyResult = await executeAutocannon({
    ...opts,
    duration: steadyDuration,
    title: `${opts.title ?? "reqstorm"}-steady`,
  });

  const steadyState = buildPhaseResult(
    "Steady-State",
    steadyDuration,
    steadyResult
  );

  const overallResult = mergeResults(warmUpResult, steadyResult);
  const overall = buildBenchmarkResult(
    opts,
    overallResult,
    warmUp,
    steadyState
  );

  return { warmUp, steadyState, overall };
}

export async function runSinglePhase(opts: RunOptions): Promise<PhaseResult> {
  const result = await executeAutocannon(opts);
  return buildPhaseResult(opts.title ?? "phase", opts.duration ?? 10, result);
}

function buildBenchmarkResult(
  opts: RunOptions,
  result: autocannon.Result,
  warmUp: PhaseResult | null,
  steadyState: PhaseResult | null
): BenchmarkResult {
  const totalRequests = result.requests.total;
  const totalErrors = result.errors;
  const errorRate =
    totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  return {
    title: opts.title ?? "reqstorm",
    url: opts.url,
    method: (opts.method ?? "GET").toUpperCase(),
    duration: result.duration,
    connections: opts.connections ?? 10,
    pipelining: opts.pipelining ?? 1,
    totalRequests,
    totalErrors,
    errorRate,
    throughput: result.requests.average,
    latency: extractLatency(result),
    ttfb: extractTtfb(result),
    warmUp: warmUp ?? undefined,
    steadyState: steadyState ?? undefined,
  };
}

function mergeResults(
  a: autocannon.Result,
  b: autocannon.Result
): autocannon.Result {
  const totalRequests = a.requests.total + b.requests.total;
  const totalErrors = a.errors + b.errors;
  const totalDuration = a.duration + b.duration;

  const weighted = (pa: number, pb: number) =>
    totalRequests > 0
      ? (pa * a.requests.total + pb * b.requests.total) / totalRequests
      : 0;

  return {
    ...b,
    duration: totalDuration,
    errors: totalErrors,
    requests: {
      ...b.requests,
      total: totalRequests,
      average: totalRequests / totalDuration,
    },
    latency: {
      ...b.latency,
      p50: weighted(a.latency.p50, b.latency.p50),
      p97_5: weighted(a.latency.p97_5, b.latency.p97_5),
      p99: weighted(a.latency.p99, b.latency.p99),
      p99_9: weighted(a.latency.p99_9, b.latency.p99_9),
    },
  };
}

function executeAutocannon(opts: RunOptions): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: opts.url,
        method: (opts.method ?? "GET") as any,
        headers: opts.headers,
        body: opts.body,
        connections: opts.connections ?? 10,
        duration: opts.duration ?? 10,
        pipelining: opts.pipelining ?? 1,
        title: opts.title,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );

    instance.on("error", (err) => {
      reject(err);
    });
  });
}
