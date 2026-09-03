import * as z from "zod/v4";
import { httpRequest, parseJsonBody } from "../utils/http-client.js";
import { jsonpathFirst } from "../utils/jsonpath.js";
import { evaluateMatch, type MatcherOp } from "../utils/matchers.js";
import { extractVariables, interpolate, type VariableSet } from "../utils/variables.js";
import type { ChainResult, ChainStepResult, ValidationAssertion } from "../utils/types.js";

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

export const chainSchema = z.object({
  baseUrl: z
    .string()
    .optional()
    .describe("Base URL prepended to step paths that start with '/'"),
  steps: z
    .array(
      z.object({
        name: z.string().describe("Step name for reporting and variable scoping"),
        request: z
          .object({
            url: z
              .string()
              .describe(
                "URL or path (relative paths are prepended with baseUrl). Supports {{variable}} interpolation."
              ),
            method: z.string().default("GET").describe("HTTP method"),
            headers: z
              .record(z.string(), z.string())
              .optional()
              .describe("Supports {{variable}} interpolation in values"),
            body: z
              .string()
              .optional()
              .describe("Request body, supports {{variable}} interpolation"),
          })
          .describe("HTTP request for this step"),
        extract: z
          .record(z.string(), z.string())
          .optional()
          .describe("JSONPath extractions: { varName: jsonPath }"),
        assertions: z
          .array(
            z.object({
              path: z
                .string()
                .describe("JSONPath expression to extract value from response"),
              match: matcherSchema,
            })
          )
          .optional()
          .describe("Assertions to evaluate against this step's response"),
        onFailure: z
          .enum(["stop", "continue"])
          .default("stop")
          .describe("What to do if this step fails"),
      })
    )
    .min(1)
    .max(20)
    .describe("Ordered list of steps to execute"),
  variables: z
    .record(z.string(), z.any())
    .optional()
    .describe("Initial variables available to all steps"),
});

function resolveUrl(url: string, baseUrl?: string): string {
  if (!baseUrl) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

export async function chainHandler(args: z.infer<typeof chainSchema>) {
  args = chainSchema.parse(args);
  const vars: VariableSet = { ...(args.variables ?? {}) };
  const stepResults: ChainStepResult[] = [];
  const allErrors: string[] = [];
  let passedAll = true;

  for (const step of args.steps) {
    const result: ChainStepResult = {
      name: step.name,
      url: "",
      method: (step.request.method ?? "GET").toUpperCase(),
      status: 0,
      responseTimeMs: 0,
      passed: false,
      assertions: [],
      extracted: {},
    };

    try {
      const rawUrl = interpolate(step.request.url, vars);
      const fullUrl = resolveUrl(rawUrl, args.baseUrl);
      result.url = fullUrl;

      const headers: Record<string, string> = {};
      if (step.request.headers) {
        for (const [k, v] of Object.entries(step.request.headers)) {
          headers[k] = interpolate(v, vars);
        }
      }
      const body = step.request.body
        ? interpolate(step.request.body, vars)
        : undefined;

      const start = Date.now();
      const res = await httpRequest({
        url: fullUrl,
        method: result.method,
        headers,
        body,
      });
      result.responseTimeMs = Date.now() - start;
      result.status = res.status;

      const bodyDoc = parseJsonBody(res.body);

      if (step.extract) {
        result.extracted = extractVariables(bodyDoc, step.extract);
        Object.assign(vars, result.extracted);
      }

      const assertions: ValidationAssertion[] = [];
      if (step.assertions) {
        for (const a of step.assertions) {
          const actual = jsonpathFirst(bodyDoc, a.path);
          const outcome = evaluateMatch(actual, a.match as MatcherOp);
          assertions.push({
            path: a.path,
            actual,
            matched: outcome.passed,
            message: outcome.message,
          });
        }
      }
      result.assertions = assertions;

      const failedAssertion = assertions.find((a) => !a.matched);
      if (failedAssertion) {
        result.passed = false;
        result.error = `Assertion failed on ${failedAssertion.path}: ${failedAssertion.message}`;
        allErrors.push(`[${step.name}] ${result.error}`);
      } else {
        result.passed = true;
      }
    } catch (err: any) {
      result.passed = false;
      result.error = err.message ?? String(err);
      allErrors.push(`[${step.name}] ${result.error}`);
    }

    stepResults.push(result);

    if (!result.passed) {
      passedAll = false;
      if (step.onFailure === "stop") break;
    }
  }

  const passedSteps = stepResults.filter((s) => s.passed).length;
  const finalVars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    finalVars[k] = typeof v === "string" ? v : JSON.stringify(v);
  }

  const chainResult: ChainResult = {
    baseUrl: args.baseUrl ?? "",
    steps: stepResults,
    passed: passedSteps === stepResults.length && passedAll,
    totalSteps: stepResults.length,
    passedSteps,
    finalVariables: finalVars,
    errors: allErrors,
  };

  return {
    content: [{ type: "text" as const, text: formatChain(chainResult) }],
  };
}

function formatChain(result: ChainResult): string {
  const SE = "═".repeat(50);
  const lines = [
    "",
    SE,
    `  Chain: ${result.totalSteps} steps`,
    SE,
    "",
  ];

  result.steps.forEach((s, i) => {
    const mark = s.passed ? "✓" : "✗";
    lines.push(
      `  [${i + 1}] ${s.name.padEnd(22)} ${mark} ${s.passed ? "PASS" : "FAIL"}${s.responseTimeMs ? `  ${s.responseTimeMs.toFixed(0)}ms` : ""}`
    );
    if (s.url) {
      lines.push(`      ${s.method} ${s.url} → ${s.status}`);
    }
    if (s.assertions.length > 0) {
      for (const a of s.assertions) {
        lines.push(`      ${a.matched ? "✓" : "✗"} ${a.path} → ${a.message}`);
      }
    }
    const extractedEntries = Object.entries(s.extracted);
    if (extractedEntries.length > 0) {
      const parts = extractedEntries
        .map(([k, v]) => `${k} = ${typeof v === "string" && v.length > 24 ? v.slice(0, 24) + "…" : JSON.stringify(v)}`)
        .join(", ");
      lines.push(`      Extracted: ${parts}`);
    }
    if (s.error) {
      lines.push(`      Error: ${s.error}`);
    }
    lines.push("");
  });

  lines.push(`  Result: ${result.passed ? "PASS" : "FAIL"} (${result.passedSteps}/${result.totalSteps} steps)`);

  const varEntries = Object.entries(result.finalVariables);
  if (varEntries.length > 0) {
    const parts = varEntries
      .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 24 ? v.slice(0, 24) + "…" : JSON.stringify(v)}`)
      .join(", ");
    lines.push(`  Final variables: { ${parts} }`);
  }

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("  Errors:");
    for (const e of result.errors) {
      lines.push(`    - ${e}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
