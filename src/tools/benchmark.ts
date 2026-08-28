import * as z from "zod/v4";
import { runBenchmarkSplit } from "../utils/autocannon.js";
import { formatBenchmark } from "../utils/formatters.js";

export const benchmarkSchema = z.object({
  url: z.string().describe("Target URL to benchmark"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Request body"),
  connections: z.number().int().positive().default(10).describe("Number of concurrent connections"),
  duration: z.number().int().positive().default(10).describe("Test duration in seconds"),
  pipelining: z.number().int().positive().default(1).describe("HTTP pipelining factor"),
  warmUpDuration: z.number().nonnegative().default(3).describe("Warm-up period in seconds (results split into warm-up vs steady-state)"),
});

export async function benchmarkHandler(args: z.infer<typeof benchmarkSchema>) {
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
  });

  return {
    content: [{ type: "text" as const, text: formatBenchmark(result.overall) }],
  };
}
