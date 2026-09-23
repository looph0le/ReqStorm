import * as z from 'zod/v4';
import autocannon from 'autocannon';
import type { SmokeResult } from '../utils/types.js';
import { formatSmoke } from '../utils/formatters.js';
import { toolResult, toolError } from '../utils/tool-result.js';
import { reportProgress, type ProgressCtx } from '../utils/progress.js';

export const smokeSchema = z.object({
  url: z.string().describe('Target URL to smoke test'),
  method: z.string().default('GET').describe('HTTP method'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Request headers (e.g. Authorization, API keys)'),
  body: z.string().optional().describe('Request body'),
  expectedStatus: z.number().int().optional().describe('Expected HTTP status code'),
  expectedBody: z.string().optional().describe('Expected substring in response body'),
  duration: z.number().int().positive().default(5).describe('Test duration in seconds'),
  connections: z.number().int().positive().default(3).describe('Number of concurrent connections'),
});

export async function smokeHandler(args: z.infer<typeof smokeSchema>, ctx: ProgressCtx = {}) {
  args = smokeSchema.parse(args);
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
          method: (args.method ?? 'GET') as any,
          headers: args.headers,
          body: args.body,
          connections: args.connections ?? 3,
          duration: args.duration ?? 5,
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

      instance.on('error', (err: Error) => reject(err));

      const totalSeconds = args.duration ?? 5;
      const startedAt = Date.now();
      (instance as any).on(
        'tick',
        () =>
          void reportProgress(
            ctx,
            Math.min((Date.now() - startedAt) / 1000, totalSeconds),
            totalSeconds,
            'Smoke test running'
          )
      );
    });

    const statusStats = result.statusCodeStats ?? {};
    const statusCodes = Object.keys(statusStats)
      .map(Number)
      .sort((a, b) => b - a);
    observedStatus = statusCodes[0] ?? null;

    if (args.expectedStatus !== undefined) {
      expectedStatusMet = observedStatus === args.expectedStatus;
      if (!expectedStatusMet) {
        pass = false;
        errors.push(
          `Expected status ${args.expectedStatus} (got ${observedStatus ?? 'no response'})`
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
      method: (args.method ?? 'GET').toUpperCase(),
      statusCode: observedStatus ?? 0,
      duration: result.duration,
      responseTime: result.latency.average ?? 0,
      latency,
      expectedStatusMet,
      expectedBodyMet,
      pass,
      errors,
    };

    return toolResult(formatSmoke(smokeResult), smokeResult);
  } catch (err: any) {
    return toolError(`Smoke test failed: ${err.message ?? err}`);
  }
}
