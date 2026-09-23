import * as z from 'zod/v4';
import autocannon from 'autocannon';
import type { ProfileResult, ProfileBucket, LatencyPercentiles } from '../utils/types.js';
import { toolResult, toolError } from '../utils/tool-result.js';
import { reportProgress, type ProgressCtx } from '../utils/progress.js';

export const profileSchema = z.object({
  url: z.string().describe('Target URL to profile'),
  method: z.string().default('GET').describe('HTTP method'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Request headers (e.g. Authorization, API keys)'),
  body: z.string().optional().describe('Request body'),
  connections: z.number().int().positive().default(5).describe('Concurrent connections'),
  duration: z.number().int().positive().default(10).describe('Duration in seconds'),
  pipelining: z.number().int().positive().default(1).describe('HTTP pipelining factor'),
  histogramBins: z
    .number()
    .int()
    .positive()
    .max(40)
    .default(20)
    .describe('Number of bins for latency histogram'),
});

interface RecordedValue {
  valueIteratedTo: number;
  countAtValueIteratedTo: number;
}

interface RecordedValuesIterator {
  hasNext(): boolean;
  next(): RecordedValue;
}

function buildHistogramBins(latency: any, bins: number): ProfileBucket[] {
  const max = Math.max(latency.p999 ?? latency.max ?? 1, 1);
  const total = latency.totalCount;
  const binCounts = new Array(bins).fill(0);
  const iter: RecordedValuesIterator | undefined = latency?.recordedValuesIterator;

  if (iter && typeof iter.hasNext === 'function') {
    while (iter.hasNext()) {
      const v = iter.next();
      const value = v.valueIteratedTo;
      const count = v.countAtValueIteratedTo ?? 1;
      const idx = Math.min(bins - 1, Math.floor((value / max) * bins));
      binCounts[idx] += count;
    }
  }

  const bucketSize = max / bins;
  return binCounts.map((count, i) => {
    const hi = (i + 1) * bucketSize;
    const label = hi >= 1000 ? `${(hi / 1000).toFixed(1)}s` : `${hi.toFixed(0)}ms`;
    return { label, percent: total > 0 ? (count / total) * 100 : 0 };
  });
}

export async function profileHandler(args: z.infer<typeof profileSchema>, ctx: ProgressCtx = {}) {
  args = profileSchema.parse(args);
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const instance = autocannon(
        {
          url: args.url,
          method: (args.method ?? 'GET') as any,
          headers: args.headers,
          body: args.body,
          connections: args.connections,
          duration: args.duration,
          pipelining: args.pipelining,
        },
        (err, res) => {
          if (err) reject(err);
          else resolve(res);
        }
      );
      instance.on('error', (err: Error) => reject(err));
      const totalSeconds = args.duration ?? 10;
      const startedAt = Date.now();
      (instance as any).on(
        'tick',
        () =>
          void reportProgress(
            ctx,
            Math.min((Date.now() - startedAt) / 1000, totalSeconds),
            totalSeconds,
            'Profiling'
          )
      );
    });

    const latency: LatencyPercentiles = {
      p50: result.latency.p50,
      p95: result.latency.p97_5,
      p99: result.latency.p99,
      p999: result.latency.p99_9,
    };

    const throughputMean = result.throughput.mean ?? result.throughput.average ?? 0;
    const throughputStddev = result.throughput.stddev ?? 0;
    const throughputCv = throughputMean > 0 ? throughputStddev / throughputMean : 0;

    const bins = Math.max(2, args.histogramBins ?? 20);
    const buckets = buildHistogramBins(result.latency, bins);

    const statusCodes = Object.entries(result.statusCodeStats ?? {}).map(
      ([status, info]: [string, any]) => ({
        status: Number(status),
        count: info?.count ?? 0,
      })
    );
    statusCodes.sort((a, b) => b.count - a.count);

    const totalRequests = result.requests?.total ?? 0;
    const profile: ProfileResult = {
      url: args.url,
      method: (args.method ?? 'GET').toUpperCase(),
      duration: result.duration,
      connections: args.connections ?? 5,
      throughput: result.requests?.average ?? 0,
      throughputCv,
      latency,
      buckets,
      statusCodes,
      errors: result.errors ?? 0,
      timeouts: result.timeouts ?? 0,
      mismatches: result.mismatches ?? 0,
    };

    return toolResult(formatProfile(profile), profile);
  } catch (err: any) {
    return toolError(`Profile failed: ${err.message ?? err}`);
  }
}

function formatProfile(result: ProfileResult): string {
  const SE = '═'.repeat(50);
  const maxBar = Math.max(...result.buckets.map((b) => b.percent), 1);
  const lines = [
    '',
    SE,
    `  Profile: ${result.method} ${result.url}`,
    SE,
    '',
    `  Duration: ${result.duration}s | Connections: ${result.connections}`,
    '',
    '  Latency Distribution:',
  ];

  for (const b of result.buckets) {
    if (b.percent <= 0) continue;
    const barLen = Math.max(1, Math.round((b.percent / maxBar) * 20));
    lines.push(`    <${b.label.padEnd(8)} █${'█'.repeat(barLen)} ${b.percent.toFixed(0)}%`);
  }

  lines.push('');
  lines.push(
    `  Percentiles: p50: ${result.latency.p50.toFixed(1)}ms | p95: ${result.latency.p95.toFixed(1)}ms | p99: ${result.latency.p99.toFixed(1)}ms | p99.9: ${result.latency.p999.toFixed(1)}ms`
  );
  lines.push(
    `  Throughput:  ${Math.round(result.throughput)} req/s (CV: ${result.throughputCv.toFixed(3)})`
  );

  if (result.statusCodes.length > 0) {
    lines.push('');
    lines.push('  Status Codes:');
    for (const sc of result.statusCodes.slice(0, 8)) {
      const total = result.statusCodes.reduce((a, s) => a + s.count, 0) || 1;
      const pct = ((sc.count / total) * 100).toFixed(1);
      lines.push(`    ${sc.status}: ${sc.count} (${pct}%)`);
    }
  }

  lines.push('');
  lines.push(
    `  Errors: ${result.errors} · Timeouts: ${result.timeouts} · Mismatches: ${result.mismatches}`
  );
  lines.push('');
  return lines.join('\n');
}
