import * as z from 'zod/v4';
import { runBenchmarkSplit } from '../utils/autocannon.js';
import { formatBenchmark } from '../utils/formatters.js';
import { saveResult } from '../utils/persistence.js';
import { toolResult } from '../utils/tool-result.js';
import { reportProgress, type ProgressCtx } from '../utils/progress.js';

export const benchmarkSchema = z.object({
  url: z.string().describe('Target URL to benchmark'),
  method: z.string().default('GET').describe('HTTP method'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Request headers (e.g. Authorization, API keys)'),
  body: z.string().optional().describe('Request body'),
  connections: z.number().int().positive().default(10).describe('Number of concurrent connections'),
  duration: z.number().int().positive().default(10).describe('Test duration in seconds'),
  pipelining: z.number().int().positive().default(1).describe('HTTP pipelining factor'),
  warmUpDuration: z
    .number()
    .nonnegative()
    .default(3)
    .describe('Warm-up period in seconds (results split into warm-up vs steady-state)'),
  saveAs: z
    .string()
    .optional()
    .describe('Save results to .reqstorm/<name>.json for future regression comparison'),
});

export async function benchmarkHandler(
  args: z.infer<typeof benchmarkSchema>,
  ctx: ProgressCtx = {}
) {
  args = benchmarkSchema.parse(args);
  const result = await runBenchmarkSplit({
    url: args.url,
    method: args.method,
    headers: args.headers,
    body: args.body,
    connections: args.connections,
    duration: args.duration,
    pipelining: args.pipelining,
    warmUpDuration: args.warmUpDuration * 1000,
    title: `reqstorm-benchmark`,
    onTick: (elapsed, total) => void reportProgress(ctx, elapsed, total, 'Benchmark running'),
  });

  if (args.saveAs) {
    const steady = result.steadyState ?? result.overall;
    saveResult(args.saveAs, 'benchmark', {
      url: args.url,
      method: (args.method ?? 'GET').toUpperCase(),
      latency: steady.latency,
      throughput: steady.throughput,
      errorRate: steady.errorRate,
      duration: steady.duration,
    });
  }

  return toolResult(formatBenchmark(result.overall), {
    ...result.overall,
    savedAs: args.saveAs ?? null,
  });
}
