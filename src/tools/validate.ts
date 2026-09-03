import * as z from "zod/v4";
import { httpRequest, parseJsonBody } from "../utils/http-client.js";
import { jsonpathFirst } from "../utils/jsonpath.js";
import { evaluateMatch, type MatcherOp } from "../utils/matchers.js";
import type { ValidationResult, ValidationAssertion } from "../utils/types.js";

const matcherSchema = z.object({
  op: z.enum([
    "equals",
    "notEquals",
    "contains",
    "matches",
    "gt",
    "lt",
    "gte",
    "lte",
    "exists",
    "notExists",
    "isType",
    "isArray",
    "hasLength",
  ]),
  expected: z.any().optional(),
  pattern: z.string().optional(),
});

export const validateSchema = z.object({
  url: z.string().describe("Target URL to validate"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Request body"),
  assertions: z
    .array(
      z.object({
        path: z
          .string()
          .describe(
            "JSONPath expression to extract value (use '$' for the full body)"
          ),
        match: matcherSchema.describe("Matcher to apply against the extracted value"),
      })
    )
    .min(1)
    .describe("List of assertions to evaluate"),
  timeouts: z
    .object({
      maxResponseMs: z
        .number()
        .nonnegative()
        .optional()
        .describe("Fail if total response time exceeds this (ms)"),
      maxTtfbMs: z
        .number()
        .nonnegative()
        .optional()
        .describe("Fail if time-to-first-byte exceeds this (ms)"),
    })
    .partial()
    .default({})
    .optional()
    .describe("Response time thresholds"),
  retries: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(0)
    .describe("Number of retries on failure"),
  retryDelayMs: z
    .number()
    .int()
    .default(1000)
    .describe("Delay between retries (ms)"),
});

function runAssertions(
  body: unknown,
  assertions: { path: string; match: {
    op: string;
    expected?: unknown;
    pattern?: string;
  } }[]
): ValidationAssertion[] {
  const results: ValidationAssertion[] = [];
  for (const a of assertions) {
    const actual = jsonpathFirst(body, a.path);
    const matcher = a.match as MatcherOp;
    const outcome = evaluateMatch(actual, matcher);
    results.push({
      path: a.path,
      actual,
      matched: outcome.passed,
      message: outcome.message,
    });
  }
  return results;
}

export async function validateHandler(args: z.infer<typeof validateSchema>) {
  args = validateSchema.parse(args);
  const errors: string[] = [];
  let assertionResults: ValidationAssertion[] = [];
  let status = 0;
  let responseTimeMs = 0;
  let ttfbMs = 0;

  for (let attempt = 1; attempt <= args.retries + 1; attempt++) {
    try {
      const res = await httpRequest({
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: args.body,
      });

      status = res.status;
      responseTimeMs = res.timingMs;
      ttfbMs = res.ttfbMs;
      const bodyDoc = parseJsonBody(res.body);
      assertionResults = runAssertions(bodyDoc, args.assertions);

      const timeoutFailures: string[] = [];
      if (args.timeouts?.maxResponseMs !== undefined && responseTimeMs > args.timeouts.maxResponseMs) {
        timeoutFailures.push(`Response time ${responseTimeMs}ms exceeds ${args.timeouts.maxResponseMs}ms`);
      }
      if (args.timeouts?.maxTtfbMs !== undefined && ttfbMs > args.timeouts.maxTtfbMs) {
        timeoutFailures.push(`TTFB ${ttfbMs}ms exceeds ${args.timeouts.maxTtfbMs}ms`);
      }

      const assertionFailed = assertionResults.some((a) => !a.matched);
      if (assertionFailed || timeoutFailures.length > 0) {
        errors.push(...timeoutFailures);
      }

      if (assertionFailed && attempt <= args.retries) {
        await new Promise((r) => setTimeout(r, args.retryDelayMs));
        continue;
      }

      const passed =
        !assertionFailed && timeoutFailures.length === 0 && errors.length === 0;

      const result: ValidationResult = {
        url: args.url,
        method: (args.method ?? "GET").toUpperCase(),
        status,
        responseTimeMs,
        ttfbMs,
        assertions: assertionResults,
        passed,
        attempts: attempt,
        errors,
      };

      return {
        content: [
          { type: "text" as const, text: formatValidate(result) },
        ],
      };
    } catch (err: any) {
      if (attempt <= args.retries) {
        await new Promise((r) => setTimeout(r, args.retryDelayMs));
        continue;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Validate failed: ${err.message ?? err}`,
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text: "Validate exhausted retries",
      },
    ],
    isError: true,
  };
}

function formatValidate(result: ValidationResult): string {
  const SE = "═".repeat(50);
  const passedCount = result.assertions.filter((a) => a.matched).length;
  const totalCount = result.assertions.length;
  const lines = [
    "",
    SE,
    `  Validate: ${result.method} ${result.url}`,
    SE,
    "",
    `Status:        ${result.status}`,
    `Response:      ${result.responseTimeMs.toFixed(1)}ms (TTFB ${result.ttfbMs.toFixed(1)}ms)`,
    `Attempts:      ${result.attempts}`,
    "",
    `  Assertions (${passedCount}/${totalCount} passed):`,
  ];

  for (const a of result.assertions) {
    const mark = a.matched ? "✓" : "✗";
    lines.push(`    ${mark} ${a.path} → ${a.message}`);
  }

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("  Errors:");
    for (const e of result.errors) {
      lines.push(`    - ${e}`);
    }
  }

  lines.push("");
  lines.push(`  Result:        ${result.passed ? "PASS" : "FAIL"}`);
  lines.push("");
  return lines.join("\n");
}
