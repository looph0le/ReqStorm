import { describe, it, expect } from 'vitest';
import { smokeHandler } from '../src/tools/smoke.js';
import { benchmarkHandler } from '../src/tools/benchmark.js';
import { compareHandler } from '../src/tools/compare.js';
import { createMockServer } from './helpers/mock-server.js';

function textOf(result: { content: { type: string; text: string }[] }): string {
  return result.content[0].text;
}

describe('autocannon-backed tools (local server)', () => {
  it('smoke passes against a healthy endpoint', async () => {
    const server = await createMockServer([{ path: '/health', body: { status: 'ok' } }]);
    const result = await smokeHandler({
      url: `${server.baseUrl}/health`,
      duration: 1,
      connections: 1,
      expectedStatus: 200,
    });
    const text = textOf(result);
    expect(text).toContain('PASS');
    expect(text).toContain('Status check:   PASS');
    await server.close();
  });

  it('smoke fails when the expected body is missing', async () => {
    const server = await createMockServer([{ path: '/health', body: { status: 'other' } }]);
    const result = await smokeHandler({
      url: `${server.baseUrl}/health`,
      duration: 1,
      connections: 1,
      expectedBody: 'never-in-body',
    });
    expect(textOf(result)).toContain('FAIL');
    await server.close();
  });

  it('smoke reports a real mean response time, not the total duration', async () => {
    const server = await createMockServer([{ path: '/', body: { ok: true } }]);
    const result = await smokeHandler({
      url: `${server.baseUrl}/`,
      duration: 1,
      connections: 1,
    });
    const text = textOf(result);
    expect(text).toMatch(/\d+\.\dms/);
    expect(text).not.toContain('Response Time:   1000.0ms');
    await server.close();
  });

  it('benchmark produces warm-up + steady-state split', async () => {
    const server = await createMockServer([{ path: '/', body: { ok: true } }]);
    const result = await benchmarkHandler({
      url: `${server.baseUrl}/`,
      duration: 4,
      warmUpDuration: 1,
      connections: 2,
    });
    const text = textOf(result);
    expect(text).toContain('Warm-up');
    expect(text).toContain('Steady-State');
    expect(text).toContain('Benchmark:');
    await server.close();
  });

  it('compare against an identical endpoint yields a SIMILAR verdict', async () => {
    const server = await createMockServer([{ path: '/', body: { ok: true } }]);
    const url = `${server.baseUrl}/`;
    const result = await compareHandler({
      baseline: { url },
      target: { url },
      duration: 1,
      warmUpDuration: 0,
      connections: 1,
      runs: 1,
      p95DeltaThreshold: 5,
      errorRateDeltaThreshold: 1,
    });
    const structured = result.structuredContent as {
      verdict?: string;
      p95DeltaThreshold?: number;
      errorRateDeltaThreshold?: number;
    };
    expect(structured.verdict).toBe('Performance is SIMILAR');
    expect(structured.p95DeltaThreshold).toBe(5);
    expect(structured.errorRateDeltaThreshold).toBe(1);
    await server.close();
  });
});
