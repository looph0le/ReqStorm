import * as z from 'zod/v4';
import SwaggerParser from '@apidevtools/swagger-parser';
import { httpRequest, parseJsonBody, statusClass } from '../utils/http-client.js';
import { jsonpathFirst } from '../utils/jsonpath.js';
import type { ContractCheckResult, EndpointCheck, BreakingChange } from '../utils/types.js';
import { toolResult, toolError } from '../utils/tool-result.js';

export const contractCheckSchema = z.object({
  specUrl: z.string().describe('URL or absolute file path to OpenAPI 3.x spec (JSON or YAML)'),
  baseUrl: z.string().describe('Base URL of the running server to test against'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Global headers applied to all requests (e.g. auth tokens)'),
  paths: z
    .array(z.string())
    .optional()
    .describe("Limit to specific paths (e.g. ['/users']). Default: all paths."),
  methods: z
    .array(z.enum(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']))
    .optional()
    .describe('Limit to specific HTTP methods. Default: all methods.'),
  includeMutatingMethods: z
    .boolean()
    .default(false)
    .describe(
      'Probe POST/PUT/PATCH/DELETE with generated request bodies (default false, since these are destructive/non-idempotent). Safe methods (GET/HEAD/OPTIONS) are always probed.'
    ),
  checks: z
    .object({
      statusCodes: z.boolean().describe('Validate response status codes match spec'),
      schemas: z.boolean().describe('Validate response body shape against spec schemas'),
      contentTypes: z.boolean().describe('Validate Content-Type headers match spec'),
      requiredFields: z.boolean().describe('Check required fields exist in responses'),
    })
    .partial()
    .default(() => ({}))
    .describe('Which checks to run; unset checks default to true'),
  previousSpecUrl: z
    .string()
    .optional()
    .describe('Previous spec to diff against for breaking-change detection'),
});

type OpenApiDocument = {
  openapi?: string;
  paths?: Record<string, Record<string, any>>;
  components?: { schemas?: Record<string, any> };
};

async function loadSpecFallback(specUrl: string): Promise<unknown> {
  if (/^https?:\/\//i.test(specUrl)) {
    const res = await httpRequest({ url: specUrl, method: 'GET', timeout: 10000 });
    if (res.status >= 200 && res.status < 300) {
      try {
        return JSON.parse(res.body);
      } catch {
        return SwaggerParser.parse(res.body);
      }
    }
    throw new Error(`Could not fetch spec (status ${res.status})`);
  }
  if (/^(file:\/\/)?\//.test(specUrl) || /\.ya?ml$/i.test(specUrl)) {
    const fs = await import('node:fs');
    const path = specUrl.replace(/^file:\/\//, '');
    const raw = fs.readFileSync(path, 'utf8');
    try {
      return JSON.parse(raw);
    } catch {
      return SwaggerParser.parse(raw);
    }
  }
  return JSON.parse(specUrl);
}

function buildExampleFromSchema(schema: any): unknown {
  if (!schema || typeof schema !== 'object') return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum !== undefined && schema.enum.length > 0) {
    return schema.enum[0];
  }
  switch (schema.type) {
    case 'object':
    case undefined: {
      if (schema.properties) {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(schema.properties)) {
          const val = buildExampleFromSchema(v as any);
          if (val !== undefined) obj[k] = val;
        }
        return obj;
      }
      return undefined;
    }
    case 'array': {
      const item = buildExampleFromSchema(schema.items);
      return item !== undefined ? [item] : [];
    }
    case 'string':
      return schema.format === 'uuid' ? '00000000-0000-0000-0000-000000000000' : 'test';
    case 'integer':
      return 1;
    case 'number':
      return 1;
    case 'boolean':
      return true;
    default:
      return undefined;
  }
}

function buildRequestBody(operation: any): string | undefined {
  const bodySchema = operation?.requestBody;
  if (!bodySchema) return undefined;
  const content = bodySchema.content;
  if (!content) return undefined;
  const json = content['application/json'];
  if (!json?.schema) return undefined;
  const example = buildExampleFromSchema(json.schema);
  if (example === undefined) return undefined;
  return JSON.stringify(example);
}

function validateAgainstSchema(body: unknown, schema: any): boolean {
  if (!schema || typeof schema !== 'object') return false;
  if (schema.example !== undefined && JSON.stringify(body) === JSON.stringify(schema.example)) {
    return true;
  }
  const type = schema.type;
  switch (type) {
    case 'object':
    case undefined: {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return false;
      }
      const obj = body as Record<string, unknown>;
      if (schema.required && Array.isArray(schema.required)) {
        for (const req of schema.required) {
          if (!(req in obj)) return false;
        }
      }
      if (schema.properties) {
        for (const [k, v] of Object.entries(schema.properties)) {
          if (k in obj) {
            if (!validateAgainstSchema(obj[k], v as any)) return false;
          }
        }
      }
      return true;
    }
    case 'array': {
      if (!Array.isArray(body)) return false;
      if (schema.items) {
        for (const item of body) {
          if (!validateAgainstSchema(item, schema.items)) return false;
        }
      }
      return true;
    }
    case 'string':
      if (typeof body !== 'string') return false;
      if (schema.pattern) {
        try {
          return new RegExp(schema.pattern).test(body);
        } catch {
          return true;
        }
      }
      return true;
    case 'integer':
      return typeof body === 'number' && Number.isInteger(body);
    case 'number':
      return typeof body === 'number';
    case 'boolean':
      return typeof body === 'boolean';
    default:
      return true;
  }
}

function extractExpectedStatus(operation: any): string {
  if (operation?.responses) {
    const keys = Object.keys(operation.responses);
    const success = keys.find((k) => k.startsWith('2'));
    if (success) return success;
    const defaultResp = keys.includes('default');
    if (defaultResp) return 'default';
  }
  return '2xx';
}

function pickStatusForRequest(operation: any): number | null {
  if (!operation?.responses) return null;
  const keys = Object.keys(operation.responses)
    .map(Number)
    .filter((n) => !isNaN(n));
  keys.sort((a, b) => a - b);
  return keys.length > 0 ? keys[0] : null;
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function diffSpecs(
  current: OpenApiDocument,
  previous: OpenApiDocument
): Promise<BreakingChange[]> {
  const changes: BreakingChange[] = [];
  const curPaths = current.paths ?? {};
  const prevPaths = previous.paths ?? {};

  for (const [path, methods] of Object.entries(prevPaths)) {
    if (!curPaths[path]) {
      changes.push({ type: 'removed', detail: `Removed path: ${path}` });
      continue;
    }
    const curMethods = curPaths[path] ?? {};
    for (const [method, prevOp] of Object.entries(methods as Record<string, any>)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      const curOp = (curMethods as Record<string, any>)[method];
      if (!curOp) {
        changes.push({
          type: 'removed',
          detail: `Removed ${method.toUpperCase()} ${path}`,
        });
        continue;
      }
      const removedResponse = diffResponseSchemas(prevOp, curOp);
      if (removedResponse) {
        changes.push({
          type: 'changed',
          detail: `${method.toUpperCase()} ${path}: ${removedResponse}`,
        });
      }
    }
  }

  for (const [path, methods] of Object.entries(curPaths)) {
    if (!prevPaths[path]) {
      changes.push({ type: 'added', detail: `Added path: ${path}` });
      continue;
    }
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      const prevOp = (prevPaths[path] as Record<string, any>)[method];
      if (!prevOp) {
        changes.push({
          type: 'added',
          detail: `Added ${method.toUpperCase()} ${path}`,
        });
      }
    }
  }

  return changes;
}

function diffResponseSchemas(prevOp: any, curOp: any): string | null {
  if (!prevOp?.responses || !curOp?.responses) return null;
  for (const [code, prevRespRaw] of Object.entries(prevOp.responses)) {
    const prevResp = prevRespRaw as any;
    const curResp = (curOp.responses as Record<string, any>)[code];
    if (!curResp) {
      return `removed response ${code}`;
    }
    const prevSchema = prevResp?.content?.['application/json']?.schema;
    const curSchema = curResp?.content?.['application/json']?.schema;
    if (prevSchema?.type === 'object' && curSchema?.type === 'object') {
      const prevProps = Object.keys(prevSchema.properties ?? {});
      const curProps = Object.keys(curSchema.properties ?? {});
      const removed = prevProps.filter((p) => !curProps.includes(p));
      if (removed.length > 0) {
        return `response ${code} removed fields: ${removed.join(', ')}`;
      }
    }
  }
  return null;
}

export async function contractCheckHandler(args: z.infer<typeof contractCheckSchema>) {
  args = contractCheckSchema.parse(args);
  const errors: string[] = [];
  try {
    let api: OpenApiDocument;
    try {
      api = (await SwaggerParser.validate(args.specUrl)) as OpenApiDocument;
    } catch (refErr: any) {
      api = (await loadSpecFallback(args.specUrl)) as OpenApiDocument;
    }
    const paths = api.paths ?? {};
    const checks = args.checks ?? {};
    const allChecks: EndpointCheck[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const [path, methods] of Object.entries(paths)) {
      if (args.paths && !args.paths.includes(path)) continue;

      for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
        if (
          ['parameters', 'summary', 'description', 'tags', 'security', 'servers'].includes(method)
        ) {
          continue;
        }
        if (args.methods && !args.methods.includes(method as any)) continue;

        const methodUppercase = method.toUpperCase();
        const isMutating = MUTATING_METHODS.has(methodUppercase);
        const url = `${args.baseUrl.replace(/\/+$/, '')}${path}`;
        const body = buildRequestBody(operation);

        let check: EndpointCheck = {
          method: methodUppercase,
          path,
          status: 0,
          expectedStatus: extractExpectedStatus(operation),
          schemaPassed: true,
          contentTypePassed: true,
          statusCodePassed: true,
          skipped: false,
        };

        if (isMutating && !args.includeMutatingMethods) {
          check.skipped = true;
          check.skipReason = 'non-safe method (opt-in required)';
          skipped++;
          allChecks.push(check);
          continue;
        }

        const successStatus = pickStatusForRequest(operation);

        try {
          const res = await httpRequest({
            url,
            method: methodUppercase,
            headers: args.headers,
            body,
            timeout: 15000,
          });
          check.status = res.status;

          if (res.status === 401 || res.status === 403) {
            check.skipped = true;
            check.skipReason = res.status === 401 ? 'authentication required' : 'forbidden';
            skipped++;
          } else {
            if (
              checks.statusCodes !== false &&
              successStatus !== null &&
              statusClass(res.status) !== statusClass(successStatus)
            ) {
              check.statusCodePassed = false;
            }

            if (
              checks.schemas !== false &&
              successStatus !== null &&
              res.status === successStatus
            ) {
              const bodyDoc = parseJsonBody(res.body);
              const successResp = (operation?.responses ?? {})[String(successStatus)];
              const schema = successResp?.content?.['application/json']?.schema;
              if (schema) {
                check.schemaPassed = validateAgainstSchema(bodyDoc, schema);
              }
            }

            if (checks.contentTypes !== false && res.status !== 0) {
              const contentType = (res.headers['content-type'] ?? '').toLowerCase();
              if (contentType && !contentType.includes('json') && !contentType.includes('text')) {
                check.contentTypePassed = false;
              }
            }
          }
        } catch (err: any) {
          if (err.message && /401|auth/i.test(err.message)) {
            check.skipped = true;
            check.skipReason = 'authentication required';
            skipped++;
          } else if (err.message && /403/i.test(err.message)) {
            check.skipped = true;
            check.skipReason = 'forbidden';
            skipped++;
          } else {
            check.statusCodePassed = false;
            check.schemaPassed = false;
            errors.push(`${methodUppercase} ${path}: ${err.message}`);
          }
        }

        const ok = check.statusCodePassed && check.schemaPassed && check.contentTypePassed;
        if (check.skipped) {
          // counted above
        } else if (ok) {
          passed++;
        } else {
          failed++;
        }
        allChecks.push(check);
      }
    }

    let breakingChanges: BreakingChange[] = [];
    if (args.previousSpecUrl) {
      try {
        const prevApi = (await SwaggerParser.validate(args.previousSpecUrl)) as OpenApiDocument;
        breakingChanges = await diffSpecs(api, prevApi);
      } catch (err: any) {
        errors.push(`Could not parse previous spec: ${err.message}`);
      }
    }

    const result: ContractCheckResult = {
      specUrl: args.specUrl,
      baseUrl: args.baseUrl,
      endpointsChecked: allChecks.length,
      endpointsPassed: passed,
      endpointsFailed: failed,
      endpointsSkipped: skipped,
      checks: allChecks,
      breakingChanges,
    };

    return toolResult(formatContractCheck(result, errors), { ...result, errors });
  } catch (err: any) {
    return toolError(`Contract check failed: ${err.message ?? err}`);
  }
}

function formatContractCheck(result: ContractCheckResult, errors: string[]): string {
  const SE = '═'.repeat(50);
  const lines = [
    '',
    SE,
    `  Contract Check: ${result.specUrl}`,
    SE,
    '',
    `  Base URL:         ${result.baseUrl}`,
    `  Endpoints checked: ${result.endpointsChecked}`,
    `  Passed:           ${result.endpointsPassed}`,
    `  Failed:           ${result.endpointsFailed}`,
    ...(result.endpointsSkipped > 0 ? [`  Skipped (auth):   ${result.endpointsSkipped}`] : []),
    '',
  ];

  for (const c of result.checks) {
    if (c.skipped) {
      lines.push(
        `  • ${c.method.padEnd(6)} ${c.path.padEnd(24)} skipped (${c.skipReason ?? 'auth'})`
      );
      continue;
    }
    const ok = c.statusCodePassed && c.schemaPassed && c.contentTypePassed;
    const mark = ok ? '✓' : '✗';
    const parts: string[] = [];
    if (!c.statusCodePassed) parts.push(`status ${c.status} (expected ${c.expectedStatus})`);
    if (!c.schemaPassed) parts.push('schema mismatch');
    if (!c.contentTypePassed) parts.push('content-type mismatch');
    lines.push(
      `  ${mark} ${c.method.padEnd(6)} ${c.path.padEnd(24)} → ${c.status}${parts.length > 0 ? '  ' + parts.join(', ') : ''}`
    );
  }

  if (result.breakingChanges.length > 0) {
    lines.push('');
    lines.push('  Breaking Changes vs previous spec:');
    for (const bc of result.breakingChanges) {
      lines.push(
        `    ${bc.type === 'removed' ? '✗ Removed' : bc.type === 'added' ? '+ Added' : '⚠ Changed'}  ${bc.detail}`
      );
    }
  }

  if (errors.length > 0) {
    lines.push('');
    lines.push('  Errors:');
    for (const e of errors) {
      lines.push(`    - ${e}`);
    }
  }

  lines.push('');
  lines.push(`  Result: ${result.endpointsFailed === 0 ? 'PASS' : 'FAIL'}`);
  lines.push('');
  return lines.join('\n');
}
