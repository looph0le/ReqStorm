import * as z from 'zod/v4';
import { runBenchmarkSplit } from '../utils/autocannon.js';
import { formatSpike } from '../utils/formatters.js';
import type { SpikeResult, PhaseResult } from '../utils/types.js';
import { toolResult, toolError } from '../utils/tool-result.js';
import { reportProgress, type ProgressCtx } from '../utils/progress.js';

export const spikeSchema = z.object({
  url: z.string().describe('Target URL'),
  method: z.string().default('GET').describe('HTTP method'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Request headers (e.g. Authorization, API keys)'),
  body: z.string().optional().describe('Request body'),
  baselineConcurrency: z.number().int().positive().default(5).describe('Normal load concurrency'),
  spikeConcurrency: z.number().int().positive().default(100).describe('Spike concurrency'),
  baselineDuration: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe('Baseline phase duration in seconds'),
  spikeDuration: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe('Spike phase duration in seconds'),
  recoveryDuration: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe('Recovery phase duration in seconds'),
  warmUpDuration: z.number().nonnegative().default(0).describe('Warm-up in seconds (0 to skip)'),
  pipelining: z.number().int().positive().default(1).describe('HTTP pipelining factor'),
});

export async function spikeHandler(args: z.infer<typeof spikeSchema>, ctx: ProgressCtx = {}) {
  args = spikeSchema.parse(args);
  try {
    const baselineConcurrency = args.baselineConcurrency ?? 5;
    const spikeConcurrency = args.spikeConcurrency ?? 100;
    const baselineDuration = args.baselineDuration ?? 10;
    const spikeDuration = args.spikeDuration ?? 10;
    const recoveryParameters = args.recoveryDuration ?? 10;
    const warmUpDuration = args.warmUpDuration ?? 0;
    const pipelining = args.pipelining ?? 1;

    const baseline = await runBenchmarkSplit({
      url: args.url,
      method: args.method,
      headers: args.headers,
      body: args.body,
      connections: baselineConcurrency,
      duration: baselineDuration,
      warmUpDuration: warmUpDuration * 1000,
      pipelining,
      title: 'reqstorm-spike-baseline',
      onTick: (elapsed, total) => void reportProgress(ctx, elapsed, total, 'Spike: baseline phase'),
    });

    const spikeRun = await runBenchmarkSplit({
      url: args.url,
      method: args.method,
      headers: args.headers,
      body: args.body,
      connections: spikeConcurrency,
      duration: spikeDuration,
      warmUpDuration: 0,
      pipelining,
      title: 'reqstorm-spike-spike',
      onTick: (elapsed, total) => void reportProgress(ctx, elapsed, total, 'Spike: spike phase'),
    });

    const recoveryRun = await runBenchmarkSplit({
      url: args.url,
      method: args.method,
      headers: args.headers,
      body: args.body,
      connections: baselineConcurrency,
      duration: recoveryParameters,
      warmUpDuration: 0,
      pipelining,
      title: 'reqstorm-spike-recovery',
      onTick: (elapsed, total) => void reportProgress(ctx, elapsed, total, 'Spike: recovery phase'),
    });

    const rename = (p: PhaseResult, label: string): PhaseResult => ({
      ...p,
      label,
    });

    const baselinePhase = rename(baseline.steadyState, 'Baseline');
    const spikePhase = rename(spikeRun.steadyState, 'Spike');
    const recoveryPhase = rename(recoveryRun.steadyState, 'Recovery');

    const baselineLatency = baselinePhase.latency.p95;
    const spikeLatency = spikePhase.latency.p95;
    const recoveryLatency = recoveryPhase.latency.p95;

    const recoveryTimeMs = Math.abs(recoveryLatency - baselineLatency);
    const recovered = recoveryLatency <= baselineLatency * 1.2;
    const degradationRatio = baselineLatency > 0 ? spikeLatency / baselineLatency : 0;

    const result: SpikeResult = {
      url: args.url,
      method: (args.method ?? 'GET').toUpperCase(),
      baseline: baselinePhase,
      spike: spikePhase,
      recovery: recoveryPhase,
      recoveryTimeMs,
      recovered,
      degradationRatio,
    };

    return toolResult(formatSpike(result), result);
  } catch (err: any) {
    return toolError(`Spike test failed: ${err.message ?? err}`);
  }
}
