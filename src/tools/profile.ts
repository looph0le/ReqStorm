import * as z from "zod/v4";
import autocannon from "autocannon";
import type { ProfileResult, ProfileBucket, LatencyPercentiles } from "../utils/types.js";

export const profileSchema = z.object({
  url: z.string().describe("Target URL to profile"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Request body"),
  connections: z.number().int().positive().default(5).describe("Concurrent connections"),
  duration: z.number().int().positive().default(10).describe("Duration in seconds"),
  pipelining: z.number().int().positive().default(1).describe("HTTP pipelining factor"),
  histogramBins: z.number().int().positive().max(40).default(20).describe("Number of bins for latency histogram"),
});

interface LatencySample {
  p50: number;
  p95: number;
  p99: number;
  p999: number;
}

export async function profileHandler(args: z.infer<typeof profileSchema>) {
  args = profileSchema.parse(args);
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const instance = autocannon(
        {
          url: args.url,
          method: (args.method ?? "GET") as any,
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
      instance.on("error", (err: Error) => reject(err));
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
    const latencyMax = Math.max(latency.p999, latency.p99, 1);
    const bucketSize = latencyMax / bins;
    const buckets: ProfileBucket[] = [];

    const hrefPoints = [latency.p50, latency.p95, latency.p99, latency.p999];
    for (let i = 0; i < bins; i++) {
      const lo = i * bucketSize;
      const hi = (i + 1) * bucketSize;
      let inBucket = 0;
      for (const p of hrefPoints) {
        if (p >= lo && p < hi) inBucket++;
      }
      if (i === bins - 1 && latency.p999 >= lo) inBucket = Math.max(inBucket, 1);
      const percent = (inBucket / Math.max(hrefPoints.length, 1)) * 100;
      const label = hi >= 1000 ? `${(hi / 1000).toFixed(1)}s` : `${hi.toFixed(0)}ms`;
      buckets.push({ label, percent });
    }

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
      method: (args.method ?? "GET").toUpperCase(),
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

    return {
      content: [{ type: "text" as const, text: formatProfile(profile) }],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Profile failed: ${err.message ?? err}`,
        },
      ],
      isError: true,
    };
  }
}

function formatProfile(result: ProfileResult): string {
  const SE = "═".repeat(50);
  const maxBar = Math.max(...result.buckets.map((b) => b.percent), 1);
  const lines = [
    "",
    SE,
    `  Profile: ${result.method} ${result.url}`,
    SE,
    "",
    `  Duration: ${result.duration}s | Connections: ${result.connections}`,
    "",
    "  Latency Distribution:",
  ];

  for (const b of result.buckets) {
    if (b.percent <= 0) continue;
    const barLen = Math.max(1, Math.round((b.percent / maxBar) * 20));
    lines.push(
      `    <${b.label.padEnd(8)} █${"█".repeat(barLen)} ${b.percent.toFixed(0)}%`
    );
  }

  lines.push("");
  lines.push(
    `  Percentiles: p50: ${result.latency.p50.toFixed(1)}ms | p95: ${result.latency.p95.toFixed(1)}ms | p99: ${result.latency.p99.toFixed(1)}ms | p99.9: ${result.latency.p999.toFixed(1)}ms`
  );
  lines.push(
    `  Throughput:  ${Math.round(result.throughput)} req/s (CV: ${result.throughputCv.toFixed(3)})`
  );

  if (result.statusCodes.length > 0) {
    lines.push("");
    lines.push("  Status Codes:");
    for (const sc of result.statusCodes.slice(0, 8)) {
      const total = result.statusCodes.reduce((a, s) => a + s.count, 0) || 1;
      const pct = ((sc.count / total) * 100).toFixed(1);
      lines.push(`    ${sc.status}: ${sc.count} (${pct}%)`);
    }
  }

  lines.push("");
  lines.push(
    `  Errors: ${result.errors} · Timeouts: ${result.timeouts} · Mismatches: ${result.mismatches}`
  );
  lines.push("");
  return lines.join("\n");
}
