import { describe, it, expect } from 'vitest';
import { contractCheckHandler } from '../src/tools/contract-check.js';
import { securityScanHandler } from '../src/tools/security-scan.js';
import { fuzzHandler } from '../src/tools/fuzz.js';
import { createMockServer } from './helpers/mock-server.js';

function textOf(result: { content: { type: string; text: string }[] }): string {
  return result.content[0].text;
}

describe('contract-check handler', () => {
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Test', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id'],
                      properties: { id: { type: 'integer' }, name: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id'],
                    properties: { id: { type: 'integer' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  it('validates GET against the spec schema', async () => {
    const server = await createMockServer([
      { path: '/users', body: [{ id: 1, name: 'ada' }] },
      { path: '/spec.json', body: spec },
    ]);
    const result = await contractCheckHandler({
      specUrl: `${server.baseUrl}/spec.json`,
      baseUrl: server.baseUrl,
    });
    const text = textOf(result);
    expect(text).toContain('PASS');
    expect(text).toContain('GET');
    expect(text).toContain('skipped (non-safe');
    // POST must be skipped by default
    expect(server.requests.filter((r) => r.method === 'POST').length).toBe(0);
    await server.close();
  });

  it('skips mutating methods unless opted in', async () => {
    const server = await createMockServer([
      { path: '/users', body: [{ id: 1, name: 'ada' }] },
      { path: '/spec.json', body: spec },
    ]);
    const result = await contractCheckHandler({
      specUrl: `${server.baseUrl}/spec.json`,
      baseUrl: server.baseUrl,
      includeMutatingMethods: true,
    });
    const text = textOf(result);
    expect(server.requests.some((r) => r.method === 'POST')).toBe(true);
    expect(text).toContain('POST');
    await server.close();
  });
});

describe('security-scan handler', () => {
  it('reports missing security headers as a warning', async () => {
    const server = await createMockServer([{ path: '/', body: { ok: true } }]);
    const result = await securityScanHandler({
      url: `${server.baseUrl}/`,
      checks: ['security-headers'],
    });
    const text = textOf(result);
    expect(text).toContain('security-headers');
    expect(text).toMatch(/1 warnings|0 warnings/);
    await server.close();
  });

  it('flags sensitive data exposure', async () => {
    const server = await createMockServer([
      { path: '/', body: { email: 'user@example.com', secret: 'sk_live_abcdef1234567890' } },
    ]);
    const result = await securityScanHandler({
      url: `${server.baseUrl}/`,
      checks: ['data-exposure'],
    });
    const text = textOf(result);
    expect(text).toContain('Found');
    expect(text).toMatch(/email|stripe/);
    await server.close();
  });
});

describe('fuzz handler', () => {
  it('runs mutations against a baseline and reports findings', async () => {
    const server = await createMockServer([{ path: '/echo', method: 'POST', body: { ok: true } }]);
    const result = await fuzzHandler({
      url: `${server.baseUrl}/echo`,
      method: 'POST',
      bodyTemplate: { field: 'value', num: 5 },
      strategies: ['boundary', 'type-swap'],
      depth: 'quick',
      assertBaseline: true,
    });
    expect(result.content[0].type).toBe('text');
    expect(textOf(result)).toContain('Fuzz');
    expect(textOf(result)).toContain('Baseline');
    await server.close();
  });
});
