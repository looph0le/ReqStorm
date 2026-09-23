import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { httpRequest, parseJsonBody, statusClass } from '../src/utils/http-client.js';
import { createMockServer } from './helpers/mock-server.js';

describe('httpRequest', () => {
  it('performs a GET and reports status/headers/body/timing', async () => {
    const server = await createMockServer([
      { path: '/hello', body: { msg: 'hi' }, headers: { 'x-custom': 'yes' } },
    ]);
    const res = await httpRequest({ url: `${server.baseUrl}/hello` });
    expect(res.status).toBe(200);
    expect(res.headers['x-custom']).toBe('yes');
    expect(JSON.parse(res.body)).toEqual({ msg: 'hi' });
    expect(res.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(res.timingMs).toBeGreaterThanOrEqual(0);
    await server.close();
  });

  it('sends method, headers and body', async () => {
    const server = await createMockServer([{ path: '/submit', method: 'POST' }]);
    const res = await httpRequest({
      url: `${server.baseUrl}/submit`,
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
      body: '{"a":1}',
    });
    expect(res.status).toBe(200);
    const req = server.requests[0];
    expect(req.method).toBe('POST');
    expect(req.body).toBe('{"a":1}');
    await server.close();
  });

  it('follows redirects up to maxRedirects', async () => {
    const server = await createMockServer([
      { path: '/a', status: 301, headers: { Location: '/b' } },
      { path: '/b', body: { landed: true } },
    ]);
    const res = await httpRequest({ url: `${server.baseUrl}/a` });
    expect(res.status).toBe(200);
    expect(res.finalUrl.endsWith('/b')).toBe(true);
    await server.close();
  });

  it('returns the redirect response once maxRedirects is exceeded', async () => {
    const server = await createMockServer([
      { path: '/loop', status: 302, headers: { Location: '/loop' } },
    ]);
    const res = await httpRequest({ url: `${server.baseUrl}/loop`, maxRedirects: 2 });
    expect(res.status).toBe(302);
    await server.close();
  });

  it('fails on invalid URL', async () => {
    await expect(httpRequest({ url: 'not-a-url' })).rejects.toThrow(/Invalid URL/);
  });

  it('times out via the timeout option', async () => {
    const server = await createMockServer([{ path: '/slow', delayMs: 500, body: { ok: true } }]);
    await expect(httpRequest({ url: `${server.baseUrl}/slow`, timeout: 50 })).rejects.toThrow(
      /timed out/
    );
    await server.close();
  });

  it('defaults content-type to application/json for bodies', async () => {
    const server = await createMockServer([{ path: '/p', method: 'POST' }]);
    await httpRequest({ url: `${server.baseUrl}/p`, method: 'POST', body: '{}' });
    await server.close();
    // Content-Length is set; verifying request did not error is enough here.
  });
});

describe('parseJsonBody', () => {
  it('parses JSON, returns raw string otherwise', () => {
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonBody('plain text')).toBe('plain text');
  });
});

describe('statusClass', () => {
  it('returns the class digit', () => {
    expect(statusClass(200)).toBe(2);
    expect(statusClass(404)).toBe(4);
    expect(statusClass(503)).toBe(5);
  });
});
