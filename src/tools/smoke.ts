import * as z from "zod/v4";
import autocannon from "autocannon";
import type { SmokeResult } from "../utils/types.js";

export const smokeSchema = z.object({
  url: z.string().describe("Target URL to smoke test"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Request body"),
  expectedStatus: z
    .number()
    .int()
    .optional()
    .describe("Expected HTTP status code"),
  expectedBody: z
    .string()
    .optional()
    .describe("Expected substring in response body"),
  duration: z.number().int().positive().default(5).describe("Test duration in seconds"),
  connections: z.number().int().positive().default(3).describe("Number of concurrent connections"),
});

export async function smokeHandler(args: z.infer<typeof smokeSchema>) {
  const errors: string[] = [];
  let pass = true;
  let expectedStatusMet: boolean | undefined;
  let expectedBodyMet: boolean | undefined;
  let observedStatus: number | null = null;
  let bodyMatches = 0;
  let bodyChecks = 0;

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
          verifyBody: (body: any) => {
            bodyChecks++;
            if (args.expectedBody === undefined) return true;
            const ok = String(body).includes(args.expectedBody);
            if (ok) bodyMatches++;
            return ok;
          },
        } as any,
        (err, res) => {
          if (err) reject(err);
          else resolve(res);
        }
      );

      instance.on("error", (err: Error) => reject(err));
    });

    for (const code of ["1xx", "2xx", "3xx", "4xx", "5xx"] as const) {
      if (result[code] > 0) {
        const base = parseInt(code[0], 10) * 100;
        observedStatus = base;
        break;
      }
    }

    if (args.expectedStatus !== undefined) {
      expectedStatusMet =
        observedStatus !== null &&
        Math.floor(observedStatus / 100) === Math.floor(args.expectedStatus / 100);
      if (!expectedStatusMet) {
        pass = false;
        errors.push(
          `Expected status ${args.expectedStatus} (got ${observedStatus ?? "no response"})`
        );
      }
    }

    if (args.expectedBody !== undefined) {
      expectedBodyMet = bodyChecks > 0 && bodyMatches === bodyChecks;
      if (!expectedBodyMet) {
        pass = false;
        errors.push(
          `Response body does not contain "${args.expectedBody}" (${bodyMatches}/${bodyChecks} matched)`
        );
      }
    }

    if (result.errors > 0) {
      pass = false;
      errors.push(`${result.errors} connection errors occurred`);
    }

    const latency = {
      p50: result.latency.p50,
      p95: result.latency.p97_5,
      p99: result.latency.p99,
      p999: result.latency.p99_9,
    };

    const smokeResult: SmokeResult = {
      url: args.url,
      method: (args.method ?? "GET").toUpperCase(),
      statusCode: observedStatus ?? 0,
      duration: result.duration,
      responseTime: result.duration,
      latency,
      expectedStatusMet,
      expectedBodyMet,
      pass,
      errors,
    };

    const lines = [
      "",
      "══════════════════════════════════════════════════",
      `  Smoke Test: ${args.method.toUpperCase()} ${args.url}`,
      "══════════════════════════════════════════════════",
      "",
      `Status Code:     ${observedStatus ?? (result.errors > 0 ? "CONN ERROR" : "N/A")}`,
      `Duration:        ${result.duration}s`,
      `Total Requests:  ${result.requests.total}`,
      "",
      `  p50: ${latency.p50.toFixed(1)}ms | p95: ${latency.p95.toFixed(1)}ms | p99: ${latency.p99.toFixed(1)}ms`,
      "",
    ];

    if (args.expectedStatus !== undefined) {
      lines.push(
        `  Status check:   ${expectedStatusMet ? "PASS" : "FAIL"}`
      );
    }
    if (args.expectedBody !== undefined) {
      lines.push(
        `  Body check:     ${expectedBodyMet ? "PASS" : "FAIL"}`
      );
    }
    if (args.expectedStatus !== undefined || args.expectedBody !== undefined) {
      lines.push("");
    }

    lines.push(`  Result:         ${pass ? "PASS" : "FAIL"}`);

    if (errors.length > 0) {
      lines.push("");
      lines.push("  Errors:");
      for (const err of errors) {
        lines.push(`    - ${err}`);
      }
    }

    lines.push("");

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Smoke test failed: ${err.message ?? err}`,
        },
      ],
      isError: true,
    };
  }
}
