import * as z from "zod/v4";
import autocannon from "autocannon";
import { formatSoak } from "../utils/formatters.js";
import type {
  SoakResult,
  SoakSnapshot,
  LatencyPercentiles,
} from "../utils/types.js";

export const soakSchema = z.object({
  url: z.string().describe("Target URL"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Request body"),
  connections: z.number().int().positive().default(10).describe("Number of concurrent connections"),
  duration: z.number().int().positive().default(1800).describe("Test duration in seconds (default 30min, max 8hr)"),
  reportInterval: z.number().int().positive().default(60).describe("Seconds between progress snapshots"),
  maxDuration: z.number().int().positive().default(28800).describe("Maximum allowed duration in seconds (8hr)"),
});

export async function soakHandler(args: z.infer<typeof soakSchema>) {
  if (args.duration > args.maxDuration) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: Duration ${args.duration}s exceeds max allowed ${args.maxDuration}s (8 hours)`,
        },
      ],
      isError: true,
    };
  }

  const snapshots: SoakSnapshot[] = [];
  let elapsed = 0;

  try {
    while (elapsed < args.duration) {
      const remaining = args.duration - elapsed;
      const chunkDuration = Math.min(remaining, args.reportInterval);

      const result = await new Promise<any>((resolve, reject) => {
        const instance = autocannon(
          {
            url: args.url,
            method: (args.method ?? "GET") as any,
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

        instance.on("error", (err: Error) => reject(err));
      });

      elapsed += chunkDuration;

      const totalReqs = result.requests.total;
      const totalErrs = result.errors;
      const errorRate = totalReqs > 0 ? (totalErrs / totalReqs) * 100 : 0;

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
      };

      snapshots.push(snapshot);
    }

    const firstSnap = snapshots[0];
    const lastSnap = snapshots[snapshots.length - 1];

    const latencyDrift =
      firstSnap.latency.p95 > 0
        ? ((lastSnap.latency.p95 - firstSnap.latency.p95) /
            firstSnap.latency.p95) *
          100
        : 0;

    const errorDrift = lastSnap.errorRate - firstSnap.errorRate;

    let memoryTrend: "stable" | "growing" | "unknown" = "unknown";
    if (snapshots.length >= 3) {
      const throughputs = snapshots.map((s) => s.throughput);
      const isDecreasing = throughputs.every(
        (v, i) => i === 0 || v <= throughputs[i - 1] * 1.05
      );
      const errorIncreasing = lastSnap.errorRate > firstSnap.errorRate + 1;
      if (isDecreasing && errorIncreasing) {
        memoryTrend = "growing";
      } else {
        memoryTrend = "stable";
      }
    }

    const passed =
      latencyDrift < 50 && errorDrift < 5 && memoryTrend !== "growing";

    const result: SoakResult = {
      url: args.url,
      method: (args.method ?? "GET").toUpperCase(),
      duration: args.duration,
      connections: args.connections,
      snapshots,
      finalLatencyDrift: latencyDrift,
      finalErrorRateDrift: errorDrift,
      memoryTrend,
      passed,
    };

    return {
      content: [{ type: "text" as const, text: formatSoak(result) }],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Soak test failed after ${elapsed}s: ${err.message ?? err}`,
        },
      ],
      isError: true,
    };
  }
}
