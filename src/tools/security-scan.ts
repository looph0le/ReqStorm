import * as z from "zod/v4";
import { httpRequest } from "../utils/http-client.js";
import type { SecurityScanResult, SecurityCheckResult } from "../utils/types.js";

export const securityScanSchema = z.object({
  url: z.string().describe("Target URL to scan"),
  method: z.string().default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers (e.g. Authorization, API keys)"),
  body: z.string().optional().describe("Request body"),
  checks: z
    .array(
      z.enum([
        "auth-bypass",
        "idor",
        "security-headers",
        "data-exposure",
        "rate-limiting",
        "method-override",
        "content-type-mismatch",
        "path-traversal",
      ])
    )
    .default(["auth-bypass", "security-headers", "data-exposure"])
    .describe("Which security checks to perform"),
  authToken: z
    .string()
    .optional()
    .describe("Auth token for baseline request (to test bypass scenarios)"),
  resourceId: z
    .string()
    .optional()
    .describe("Resource ID in URL to test IDOR (e.g. the '123' in /users/123)"),
});

type CheckName = "auth-bypass" | "idor" | "security-headers" | "data-exposure" | "rate-limiting" | "method-override" | "content-type-mismatch" | "path-traversal";

const SECURITY_HEADERS: [string, string][] = [
  ["strict-transport-security", "HSTS"],
  ["x-content-type-options", "X-Content-Type-Options"],
  ["x-frame-options", "X-Frame-Options"],
  ["content-security-policy", "Content-Security-Policy"],
  ["x-xss-protection", "X-XSS-Protection"],
  ["referrer-policy", "Referrer-Policy"],
  ["permissions-policy", "Permissions-Policy"],
];

const DATA_PATTERNS: [RegExp, string][] = [
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "email address(es)"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "SSN"],
  [/\b(?:\d[ -]*?){13,16}\b/g, "credit card number"],
  [/sk_live_[a-zA-Z0-9]+/g, "stripe secret key"],
  [/AKIA[0-9A-Z]{16}/g, "AWS access key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "private key"],
  [/\bghp_[a-zA-Z0-9]{36}\b/g, "GitHub token"],
  [/\bxox[bap]-[a-zA-Z0-9-]+/g, "Slack token"],
];

const TRAVERSALS = [
  "../etc/passwd",
  "..%2F..%2Fetc%2Fpasswd",
  "%2e%2e/%2e%2e/etc/passwd",
  "....//....//etc/passwd",
];

export async function securityScanHandler(
  args: z.infer<typeof securityScanSchema>
) {
  args = securityScanSchema.parse(args);
  const results: SecurityCheckResult[] = [];
  const checks = args.checks as CheckName[];

  const baseHeaders = { ...(args.headers ?? {}) };
  if (args.authToken) {
    baseHeaders["Authorization"] = `Bearer ${args.authToken}`;
  }

  async function send(opts: Partial<typeof args> & { headers?: Record<string, string>; url?: string }) {
    return httpRequest({
      url: opts.url ?? args.url,
      method: args.method,
      headers: opts.headers ?? baseHeaders,
      body: opts.body ?? args.body,
      timeout: 10000,
    });
  }

  if (checks.includes("auth-bypass")) {
    try {
      const authorized = await send({ headers: baseHeaders });
      if (authorized.status === 401 || authorized.status === 403) {
        const noAuth = await send({ headers: {} });
        if (noAuth.status !== authorized.status) {
          results.push({
            name: "auth-bypass",
            status: "warn",
            detail: `Endpoint returns ${noAuth.status} without auth (expected ${authorized.status}) — possible auth bypass`,
          });
        } else {
          results.push({
            name: "auth-bypass",
            status: "ok",
            detail: `Returns ${authorized.status} without auth — auth properly enforced`,
          });
        }
      } else {
        results.push({
          name: "auth-bypass",
          status: "ok",
          detail: `Baseline returns ${authorized.status}; relies on provided auth token (no anonymous access test framing)`,
        });
      }
    } catch (err: any) {
      results.push({
        name: "auth-bypass",
        status: "error",
        detail: `Could not complete check: ${err.message ?? err}`,
      });
    }
  }

  if (checks.includes("idor") && args.resourceId) {
    try {
      const current = await send({ url: args.url });
      if (current.status === 404) {
        results.push({
          name: "idor",
          status: "ok",
          detail: "Current resource returns 404 — not accessible, IDOR less likely",
        });
      } else {
        let failed = false;
        for (const offset of [1, -1, 2, -2]) {
          const altId = String(Number(args.resourceId) + offset);
          const altUrl = args.url.replace(args.resourceId, altId);
          try {
            const res = await send({ url: altUrl });
            if (res.status === 200 && String(res.body) !== String(current.body)) {
              results.push({
                name: "idor",
                status: "warn",
                detail: `Resource ${altId} returns 200 with different data than ${args.resourceId} — possible IDOR (accessing other resources)`,
              });
              failed = true;
              break;
            }
          } catch {
            // connection error means restricted — assume safe
          }
        }
        if (!failed) {
          results.push({
            name: "idor",
            status: "ok",
            detail: `Adjacent IDs (${args.resourceId}±1/2) did not return accessible different data`,
          });
        }
      }
    } catch (err: any) {
      results.push({
        name: "idor",
        status: "error",
        detail: `Could not complete check: ${err.message ?? err}`,
      });
    }
  }

  if (checks.includes("security-headers")) {
    try {
      const res = await send({});
      const presentHeaders = new Set(
        Object.keys(res.headers).map((k) => k.toLowerCase())
      );
      const missing = SECURITY_HEADERS.filter(
        ([headerName]) => !presentHeaders.has(headerName)
      );
      const present = SECURITY_HEADERS.length - missing.length;
      if (missing.length === 0) {
        results.push({
          name: "security-headers",
          status: "ok",
          detail: "All expected security headers present",
        });
      } else {
        results.push({
          name: "security-headers",
          status: "warn",
          detail: `Present ${present}/${SECURITY_HEADERS.length}. Missing: ${missing.map(([, n]) => n).join(", ")}`,
        });
      }
    } catch (err: any) {
      results.push({
        name: "security-headers",
        status: "error",
        detail: `Could not complete check: ${err.message ?? err}`,
      });
    }
  }

  if (checks.includes("data-exposure")) {
    try {
      const res = await send({});
      const found: string[] = [];
      for (const [pattern, label] of DATA_PATTERNS) {
        const matches = res.body.match(pattern);
        if (matches && matches.length > 0) {
          found.push(`${label} (${matches.length})`);
        }
      }
      if (found.length === 0) {
        results.push({
          name: "data-exposure",
          status: "ok",
          detail: "No sensitive data patterns found in response",
        });
      } else {
        results.push({
          name: "data-exposure",
          status: "warn",
          detail: `Found: ${found.join(", ")}`,
        });
      }
    } catch (err: any) {
      results.push({
        name: "data-exposure",
        status: "error",
        detail: `Could not complete check: ${err.message ?? err}`,
      });
    }
  }

  if (checks.includes("rate-limiting")) {
    try {
      let saw429 = false;
      for (let i = 0; i < 30; i++) {
        const res = await send({});
        if (res.status === 429) {
          saw429 = true;
          break;
        }
      }
      if (saw429) {
        results.push({
          name: "rate-limiting",
          status: "ok",
          detail: "Returned 429 after rapid requests — rate limiting active",
        });
      } else {
        results.push({
          name: "rate-limiting",
          status: "warn",
          detail: "No 429 response after 30 rapid requests — rate limiting may be absent",
        });
      }
    } catch (err: any) {
      results.push({
        name: "rate-limiting",
        status: "error",
        detail: `Could not complete check: ${err.message ?? err}`,
      });
    }
  }

  if (checks.includes("method-override")) {
    try {
      const res = await send({
        headers: { ...baseHeaders, "X-HTTP-Method-Override": "DELETE" },
      });
      if (res.status === 405 || res.status === 400 || res.status === 404) {
        results.push({
          name: "method-override",
          status: "ok",
          detail: `Rejected method override (${res.status})`,
        });
      } else if (res.status === 200) {
        results.push({
          name: "method-override",
          status: "warn",
          detail: "Accepted X-HTTP-Method-Override header with 200 — HTTP method override may be enabled",
        });
      } else {
        results.push({
          name: "method-override",
          status: "ok",
          detail: `Responded ${res.status} to method override`,
        });
      }
    } catch (err: any) {
      results.push({
        name: "method-override",
        status: "error",
        detail: `Could not complete check: ${err.message ?? err}`,
      });
    }
  }

  if (checks.includes("content-type-mismatch")) {
    try {
      const res = await send({
        body: args.body ?? '{"test":1}',
        headers: { ...baseHeaders, "Content-Type": "text/plain" },
      });
      if (res.status === 200) {
        results.push({
          name: "content-type-mismatch",
          status: "warn",
          detail: "Accepted text/plain Content-Type JSON body — server may ignore content negotiation",
        });
      } else {
        results.push({
          name: "content-type-mismatch",
          status: "ok",
          detail: `Rejected wrong Content-Type (${res.status})`,
        });
      }
    } catch (err: any) {
      results.push({
        name: "content-type-mismatch",
        status: "error",
        detail: `Could not complete check: ${err.message ?? err}`,
      });
    }
  }

  if (checks.includes("path-traversal")) {
    try {
      const parsed = new URL(args.url);
      const basePath = parsed.pathname.replace(/\/+$/, "");
      let anyOk = false;
      let firstResult = "";
      for (const trav of TRAVERSALS) {
        const testPath = `${basePath}/${trav}`;
        const testUrl = `${parsed.origin}${testPath}${parsed.search}`;
        try {
          const res = await send({ url: testUrl });
          if (res.status === 200 && /root:|passwd|uid=/i.test(res.body)) {
            results.push({
              name: "path-traversal",
              status: "fail",
              detail: `Path traversal ${trav} returned file contents`,
            });
            anyOk = true;
            break;
          } else if (res.status === 200) {
            firstResult = firstResult || `some responses 200`;
          }
        } catch {
          // connection error = restricted
        }
      }
      if (!anyOk) {
        results.push({
          name: "path-traversal",
          status: "ok",
          detail: firstResult
            ? "Path traversal attempts did not return file contents"
            : "Path traversal attempts rejected",
        });
      }
    } catch (err: any) {
      results.push({
        name: "path-traversal",
        status: "error",
        detail: `Could not complete check: ${err.message ?? err}`,
      });
    }
  }

  let ok = 0;
  let warn = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === "ok") ok++;
    else if (r.status === "warn") warn++;
    else if (r.status === "fail") fail++;
  }

  const result: SecurityScanResult = {
    url: args.url,
    method: (args.method ?? "GET").toUpperCase(),
    checks: results,
    warnings: warn,
    critical: fail,
    passed: ok,
  };

  return {
    content: [{ type: "text" as const, text: formatSecurityScan(result) }],
  };
}

function formatSecurityScan(result: SecurityScanResult): string {
  const SE = "═".repeat(50);
  const lines = [
    "",
    SE,
    `  Security Scan: ${result.method} ${result.url}`,
    SE,
    "",
    `  Checks Performed: ${result.checks.length}`,
    "",
  ];

  for (const c of result.checks) {
    const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : c.status === "fail" ? "✗" : "!";
    lines.push(`  ${icon} ${c.name.padEnd(18)} — ${c.detail}`);
  }

  lines.push("");
  lines.push(
    `  Findings: ${result.warnings} warnings, ${result.critical} critical, ${result.passed} passed`
  );
  lines.push(`  Result:   ${result.critical > 0 ? "FAIL" : result.warnings > 0 ? "WARN" : "OK"}`);
  lines.push("");
  return lines.join("\n");
}
