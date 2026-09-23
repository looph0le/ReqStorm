import * as z from 'zod/v4';
import autocannon from 'autocannon';
import { formatStressTest } from '../utils/formatters.js';
import type { StressStep, StressTestResult } from '../utils/types.js';
import { toolResult, toolError } from '../utils/tool-result.js';
import { reportProgress, type ProgressCtx } from '../utils/progress.js';

export const stressTestSchema = z.object({
  url: z.string().describe('Target URL'),
  method: z.string().default('GET').describe('HTTP method'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Request headers (e.g. Authorization, API keys)'),
  body: z.string().optional().describe('Request body'),
  startConcurrency: z.number().int().positive().default(1).describe('Starting concurrency'),
  stepSize: z.number().int().positive().default(5).describe('Concurrency increment per step'),
  stepDuration: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe('Duration of each step in seconds'),
  maxConcurrency: z.number().int().positive().default(200).describe('Maximum concurrency cap'),
  breakThreshold: z
    .object({
      maxP95: z.number().nonnegative().default(500).describe('p95 threshold in ms'),
      maxErrorRate: z.number().min(0).max(100).default(10).describe('Error rate threshold (%)'),
    })
    .partial()
    .default({})
    .describe('What defines the breaking point'),
});

function runPhase(opts: autocannon.Options, duration: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const instance = autocannon({ ...opts, duration }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    instance.on('error', (err: Error) => reject(err));
  });
}

export async function stressTestHandler(
  args: z.infer<typeof stressTestSchema>,
  ctx: ProgressCtx = {}
) {
  args = stressTestSchema.parse(args);
  const steps: StressStep[] = [];
  let breakingConcurrency: number | null = null;
  let maxThroughput = 0;
  let maxThroughputConcurrency = 0;

  let concurrency = args.startConcurrency ?? 1;
  const stepSize = args.stepSize ?? 5;
  const stepDuration = args.stepDuration ?? 10;
  const maxConcurrency = args.maxConcurrency ?? 200;
  const breakThreshold = args.breakThreshold ?? {};
  const breakP95 = breakThreshold.maxP95 ?? 500;
  const breakErrorRate = breakThreshold.maxErrorRate ?? 10;

  try {
    while (concurrency <= maxConcurrency) {
      const result = await runPhase(
        {
          url: args.url,
          method: (args.method ?? 'GET') as any,
          headers: args.headers,
          body: args.body,
          connections: concurrency,
        },
        stepDuration
      );

      const totalReqs = result.requests.total;
      const totalErrs = result.errors;
      const errorRate = totalReqs > 0 ? (totalErrs / totalReqs) * 100 : 0;
      const throughput = result.requests.average;

      const step: StressStep = {
        concurrency,
        latency: {
          p50: result.latency.p50,
          p95: result.latency.p97_5,
          p99: result.latency.p99,
          p999: result.latency.p99_9,
        },
        throughput,
        errorRate,
      };

      steps.push(step);

      await reportProgress(
        ctx,
        concurrency,
        maxConcurrency,
        `Step at ${concurrency} conns (p95 ${step.latency.p95.toFixed(0)}ms, ${step.errorRate.toFixed(1)}% err)`
      );

      if (throughput > maxThroughput) {
        maxThroughput = throughput;
        maxThroughputConcurrency = concurrency;
      }

      const broken = step.latency.p95 > breakP95 || step.errorRate > breakErrorRate;

      if (broken && breakingConcurrency === null) {
        breakingConcurrency = concurrency;
      }

      concurrency += stepSize;
    }

    const result: StressTestResult = {
      url: args.url,
      method: (args.method ?? 'GET').toUpperCase(),
      steps,
      breakingPoint:
        breakingConcurrency !== null
          ? (steps.find((s) => s.concurrency === breakingConcurrency)?.latency.p95 ?? null)
          : null,
      breakingConcurrency,
      maxThroughput,
      maxThroughputConcurrency,
    };

    return toolResult(formatStressTest(result), result);
  } catch (err: any) {
    return toolError(`Stress test failed at ${concurrency} conns: ${err.message ?? err}`);
  }
}
