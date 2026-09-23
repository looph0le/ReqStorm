import * as z from 'zod/v4';
import autocannon from 'autocannon';
import { formatSoak } from '../utils/formatters.js';
import type { SoakResult, SoakSnapshot, LatencyPercentiles } from '../utils/types.js';
import { toolResult, toolError } from '../utils/tool-result.js';
import { reportProgress, type ProgressCtx } from '../utils/progress.js';

export const soakSchema = z.object({
  url: z.string().describe('Target URL'),
  method: z.string().default('GET').describe('HTTP method'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Request headers (e.g. Authorization, API keys)'),
  body: z.string().optional().describe('Request body'),
  connections: z.number().int().positive().default(10).describe('Number of concurrent connections'),
  duration: z
    .number()
    .int()
    .positive()
    .default(1800)
    .describe('Test duration in seconds (default 30min, max 8hr)'),
  reportInterval: z
    .number()
    .int()
    .positive()
    .default(60)
    .describe('Seconds between progress snapshots'),
  maxDuration: z
    .number()
    .int()
    .positive()
    .default(28800)
    .describe('Maximum allowed duration in seconds (8hr)'),
});

export async function soakHandler(args: z.infer<typeof soakSchema>, ctx: ProgressCtx = {}) {
  args = soakSchema.parse(args);
  if (args.duration > args.maxDuration) {
    return toolError(
      `Error: Duration ${args.duration}s exceeds max allowed ${args.maxDuration}s (8 hours)`
    );
  }

  const snapshots: SoakSnapshot[] = [];
  let elapsed = 0;
  const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;

  try {
    while (elapsed < args.duration) {
      const remaining = args.duration - elapsed;
      const chunkDuration = Math.min(remaining, args.reportInterval);

      const result = await new Promise<any>((resolve, reject) => {
        const instance = autocannon(
          {
            url: args.url,
            method: (args.method ?? 'GET') as any,
            headers: args.headers,
            body: args.body,
            connections: args.connections,
            duration: chunkDuration,
          },
          (err, res) => {
            if (err) reject(err);
            else resolve(res);
          }
        );

        instance.on('error', (err: Error) => reject(err));
      });

      elapsed += chunkDuration;

      const totalReqs = result.requests.total;
      const totalErrs = result.errors;
      const errorRate = totalReqs > 0 ? (totalErrs / totalReqs) * 100 : 0;

      const memory = process.memoryUsage();

      const snapshot: SoakSnapshot = {
        timestamp: Date.now(),
        elapsed,
        latency: {
          p50: result.latency.p50,
          p95: result.latency.p97_5,
          p99: result.latency.p99,
          p999: result.latency.p99_9,
        },
        throughput: result.requests.average,
        errorRate,
        heapUsedMb: mb(memory.heapUsed),
        rssMb: mb(memory.rss),
      };

      snapshots.push(snapshot);
      await reportProgress(
        ctx,
        elapsed,
        args.duration,
        `Elapsed ${elapsed}s of ${args.duration}s (snapshot ${snapshots.length})`
      );
    }

    const firstSnap = snapshots[0];
    const lastSnap = snapshots[snapshots.length - 1];

    const latencyDrift =
      firstSnap.latency.p95 > 0
        ? ((lastSnap.latency.p95 - firstSnap.latency.p95) / firstSnap.latency.p95) * 100
        : 0;

    const errorDrift = lastSnap.errorRate - firstSnap.errorRate;

    let memoryTrend: 'stable' | 'growing' | 'unknown' = 'unknown';
    if (snapshots.length >= 2) {
      const heapGrowthPct =
        firstSnap.heapUsedMb > 0
          ? ((lastSnap.heapUsedMb - firstSnap.heapUsedMb) / firstSnap.heapUsedMb) * 100
          : 0;
      const rssGrowthPct =
        firstSnap.rssMb > 0 ? ((lastSnap.rssMb - firstSnap.rssMb) / firstSnap.rssMb) * 100 : 0;
      memoryTrend = heapGrowthPct > 15 || rssGrowthPct > 15 ? 'growing' : 'stable';
    }

    const passed = latencyDrift < 50 && errorDrift < 5 && memoryTrend !== 'growing';

    const result: SoakResult = {
      url: args.url,
      method: (args.method ?? 'GET').toUpperCase(),
      duration: args.duration,
      connections: args.connections,
      snapshots,
      finalLatencyDrift: latencyDrift,
      finalErrorRateDrift: errorDrift,
      memoryTrend,
      passed,
    };

    return toolResult(formatSoak(result), result);
  } catch (err: any) {
    return toolError(`Soak test failed after ${elapsed}s: ${err.message ?? err}`);
  }
}
