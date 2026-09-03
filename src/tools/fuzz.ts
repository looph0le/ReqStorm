import * as z from "zod/v4";
import { httpRequest } from "../utils/http-client.js";
import type { FuzzResult, FuzzFinding } from "../utils/types.js";

export const fuzzSchema = z.object({
  url: z.string().describe("Target URL"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Base body to mutate (JSON string)"),
  bodyTemplate: z
    .any()
    .optional()
    .describe("Base body as structured object (alternative to body string)"),
  strategies: z
    .array(
      z.enum([
        "boundary",
        "type-swap",
        "injection",
        "overflow",
        "missing-fields",
        "unicode",
        "format",
        "null-field",
      ])
    )
    .default(["boundary", "type-swap", "injection", "overflow"])
    .describe("Mutation strategies to apply"),
  depth: z
    .enum(["quick", "normal", "thorough"])
    .default("normal")
    .describe("Intensity level (quick=50, normal=200, thorough=500 mutations)"),
  assertBaseline: z
    .boolean()
    .default(true)
    .describe("Send unmutated request first to establish baseline"),
  failStatuses: z
    .array(z.number())
    .default([500, 502, 503, 504])
    .describe("Status codes considered hard failures"),
  timeout: z.number().int().default(5000).describe("Per-request timeout (ms)"),
});

type Strategy = "boundary" | "type-swap" | "injection" | "overflow" | "missing-fields" | "unicode" | "format" | "null-field";

const DEPTH_COUNTS: Record<"quick" | "normal" | "thorough", Record<Strategy, number>> = {
  quick: { boundary: 8, "type-swap": 8, injection: 8, overflow: 6, "missing-fields": 8, unicode: 4, format: 4, "null-field": 4 },
  normal: { boundary: 16, "type-swap": 12, injection: 16, overflow: 12, "missing-fields": 12, unicode: 8, format: 8, "null-field": 8 },
  thorough: { boundary: 30, "type-swap": 24, injection: 32, overflow: 24, "missing-fields": 20, unicode: 16, format: 16, "null-field": 16 },
};

const INJECTION_PAYLOADS = [
  "'; DROP TABLE users;--",
  "\" OR \"1\"=\"1",
  "1 OR 1=1",
  "<script>alert(1)</script>",
  "{{constructor.constructor('process.exit(1)')()}}",
  "${{7*7}}",
  `%00../etc/passwd`,
  "../../../etc/passwd",
  "<img src=x onerror=alert(1)>",
];

const UNICODE_PAYLOADS = [
  "\u0000",
  "\u202E\u202D",
  "a\u0300\u0301\u0302",
  "\uFFFD\uFFFD\uFFFD",
  "\ud83d\ude00\u200d\ud83d\ude00",
  "\u0001\u0002\u0003",
  "𐀀𐀁𐀂",
];

const FORMAT_PAYLOADS = [
  "not-an-email",
  "a@",
  "@domain.com",
  "http://",
  "2024-13-45",
  "not-a-uuid",
  "+",
  "1e999",
  "NaN",
  "Infinity",
];

const BOUNDARY_VALUES = [
  "",
  0,
  -1,
  1,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  " ",
  "\n",
];

function flattenPathEntries(
  obj: Record<string, unknown>,
  prefix: string = ""
): { path: string; key: string; value: unknown }[] {
  const entries: { path: string; key: string; value: unknown }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof RegExp)) {
      entries.push(...flattenPathEntries(v as Record<string, unknown>, key));
    } else {
      entries.push({ path: key, key, value: v });
    }
  }
  return entries;
}

function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".");
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null) {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

function mutateValue(value: unknown, strategy: Strategy): unknown {
  switch (strategy) {
    case "boundary": {
      const choices = BOUNDARY_VALUES;
      return choices[Math.floor(Math.random() * choices.length)];
    }
    case "type-swap": {
      if (typeof value === "number") return String(value);
      if (typeof value === "string") {
        return /^-?\d+\.?\d*$/.test(value) ? Number(value) : { type: value };
      }
      if (typeof value === "boolean") return value ? 1 : 0;
      return [value];
    }
    case "injection":
      return INJECTION_PAYLOADS[Math.floor(Math.random() * INJECTION_PAYLOADS.length)];
    case "overflow":
      return "x".repeat(10000);
    case "unicode":
      return UNICODE_PAYLOADS[Math.floor(Math.random() * UNICODE_PAYLOADS.length)];
    case "format":
      return FORMAT_PAYLOADS[Math.floor(Math.random() * FORMAT_PAYLOADS.length)];
    case "null-field":
      return null;
    default:
      return value;
  }
}

function isExpectedStatus(status: number, baseline: number): boolean {
  return status === baseline || (status >= 400 && status < 500) || status === 200;
}

export async function fuzzHandler(args: z.infer<typeof fuzzSchema>) {
  args = fuzzSchema.parse(args);
  let baseBody: Record<string, unknown> = {};
  let hasBody = false;

  if (args.bodyTemplate !== undefined) {
    baseBody = args.bodyTemplate as Record<string, unknown>;
    hasBody = true;
  } else if (args.body) {
    try {
      baseBody = JSON.parse(args.body) as Record<string, unknown>;
      hasBody = true;
    } catch {
      baseBody = {};
    }
  }

  const bodyStrategies: Strategy[] = ["boundary", "type-swap", "injection", "overflow", "unicode", "format", "null-field", "missing-fields"];

  const activeStrategies: Strategy[] =
    args.strategies ?? ["boundary", "type-swap", "injection", "overflow"];
  const depth: keyof typeof DEPTH_COUNTS = args.depth ?? "normal";

  let baselineStatus = 0;
  let baselineTimeMs = 0;
  if (args.assertBaseline) {
    try {
      const res = await httpRequest({
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: hasBody ? JSON.stringify(baseBody) : undefined,
        timeout: args.timeout ?? 5000,
      });
      baselineStatus = res.status;
      baselineTimeMs = res.timingMs;
    } catch {
      baselineStatus = 0;
    }
  }

  const mutations: { label: string; category: string; body?: string }[] = [];

  if (hasBody) {
    const entries = flattenPathEntries(baseBody);
    for (const strategy of bodyStrategies) {
      if (!activeStrategies.includes(strategy)) continue;
      if (strategy === "missing-fields") {
        for (const entry of entries) {
          mutations.push({
            label: `missing-fields:${entry.path}`,
            category: strategy,
            body: JSON.stringify((() => {
              const copy = structuredClone(baseBody);
              deleteByPath(copy, entry.path);
              return copy;
            })()),
          });
        }
        continue;
      }
      if (strategy === "type-swap" || strategy === "overflow" || strategy === "unicode") {
        for (const entry of entries.filter((e) => e.value !== null)) {
          const copy = structuredClone(baseBody);
          setByPath(copy, entry.path, mutateValue(entry.value, strategy));
          mutations.push({
            label: `${strategy}:${entry.path}`,
            category: strategy,
            body: JSON.stringify(copy),
          });
        }
        continue;
      }
      const count = DEPTH_COUNTS[depth][strategy] ?? 8;
      for (let i = 0; i < count; i++) {
        if (entries.length === 0) break;
        const entry = entries[Math.floor(Math.random() * entries.length)];
        const copy = structuredClone(baseBody);
        setByPath(copy, entry.path, mutateValue(entry.value, strategy));
        mutations.push({
          label: `${strategy}:${entry.path}#${i}`,
          category: strategy,
          body: JSON.stringify(copy),
        });
      }
    }
  } else {
    for (const strategy of activeStrategies) {
      if (!["boundary", "overflow", "injection", "unicode", "format"].includes(strategy)) continue;
      const count = DEPTH_COUNTS[depth][strategy as Strategy] ?? 4;
      for (let i = 0; i < count; i++) {
        const value = mutateValue("x", strategy as Strategy);
        mutations.push({
          label: `${strategy}:direct#${i}`,
          category: strategy,
          body: typeof value === "string" ? value : JSON.stringify(value),
        });
      }
    }
  }

  const findings: FuzzFinding[] = [];
  let passed = 0;
  let interesting = 0;
  let failed = 0;
  let crashes = 0;
  let timeouts = 0;

  const failStatuses = args.failStatuses ?? [500, 502, 503, 504];

  const dedupe = new Set<string>();

  for (const mutation of mutations) {
    try {
      const res = await httpRequest({
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: mutation.body,
        timeout: args.timeout ?? 5000,
      });

      const dedupeKey = `${mutation.category}:${res.status}`;
      if (dedupe.has(dedupeKey)) continue;
      dedupe.add(dedupeKey);

      if (failStatuses.includes(res.status)) {
        failed++;
        findings.push({
          mutation: mutation.label,
          category: mutation.category,
          status: res.status,
          baselineStatus,
          issue: `Returned error status ${res.status}`,
        });
      } else if (baselineStatus !== 0 && !isExpectedStatus(res.status, baselineStatus)) {
        interesting++;
        if (findings.length < 20) {
          findings.push({
            mutation: mutation.label,
            category: mutation.category,
            status: res.status,
            baselineStatus,
            issue: `Unexpected status ${res.status} (baseline ${baselineStatus})`,
          });
        }
      } else {
        passed++;
      }
    } catch (err: any) {
      crashes++;
      if (findings.length < 20) {
        findings.push({
          mutation: mutation.label,
          category: mutation.category,
          status: 0,
          baselineStatus,
          issue: `Connection error: ${err.message ?? err}`,
        });
      }
    }
  }

  const result: FuzzResult = {
    url: args.url,
    method: (args.method ?? "GET").toUpperCase(),
    totalMutations: mutations.length,
    baselineStatus,
    baselineTimeMs,
    passed,
    interesting,
    failed,
    crashes,
    timeouts,
    findings: findings.slice(0, 20),
  };

  return {
    content: [{ type: "text" as const, text: formatFuzz(result) }],
  };
}

function formatFuzz(result: FuzzResult): string {
  const SE = "═".repeat(50);
  const lines = [
    "",
    SE,
    `  Fuzz: ${result.method} ${result.url}`,
    SE,
    "",
  ];

  if (result.baselineStatus) {
    lines.push(
      `  Baseline:     ${result.baselineStatus} (${result.baselineTimeMs.toFixed(0)}ms)`
    );
  } else {
    lines.push(`  Baseline:     none (assertBaseline=false)`);
  }
  lines.push(`  Mutations:    ${result.totalMutations}`);
  lines.push(
    `  Result:       ${result.passed} passed · ${result.interesting} interesting · ${result.failed} failed · ${result.crashes} crashes · ${result.timeouts} timeouts`
  );
  lines.push("");

  if (result.findings.length > 0) {
    lines.push("  Interesting Findings:");
    for (const f of result.findings) {
      lines.push(`    ${f.status ? `[${f.status}]` : "  [ERR]"} ${f.category}: ${f.mutation} — ${f.issue}`);
    }
    lines.push("");
  } else {
    lines.push("  No interesting findings detected.");
    lines.push("");
  }

  lines.push("");
  return lines.join("\n");
}
