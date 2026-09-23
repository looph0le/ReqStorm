import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateHandler } from '../src/tools/validate.js';
import { chainHandler } from '../src/tools/chain.js';

function textOf(result: { content: { type: string; text: string }[] }): string {
  return result.content[0].text;
}

async function createCountingServer(
  handler: (
    attempt: number,
    method: string,
    path: string,
    body: string,
    headers: http.IncomingHttpHeaders
  ) => { status: number; delayMs: number; body: string }
): Promise<{ baseUrl: string; attempts: () => number; close: () => Promise<void> }> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      const r = handler(count, req.method ?? 'GET', req.url ?? '/', body, req.headers);
      const bytes = Buffer.from(r.body);
      const respond = () => {
        res.writeHead(r.status, {
          'Content-Type': 'application/json',
          'Content-Length': bytes.length,
        });
        res.end(r.body);
      };
      if (r.delayMs > 0) setTimeout(respond, r.delayMs);
      else respond();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    attempts: () => count,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('validate handler', () => {
  it('does not carry transient timeout failures across retries', async () => {
    const server = await createCountingServer((attempt) => {
      if (attempt === 1) {
        return { status: 200, delayMs: 200, body: '{"value":"ok"}' };
      }
      return { status: 200, delayMs: 0, body: '{"value":"ok"}' };
    });

    const result = await validateHandler({
      url: `${server.baseUrl}/x`,
      assertions: [{ path: '$.value', match: { op: 'equals', expected: 'ok' } }],
      retries: 1,
      retryDelayMs: 0,
      timeouts: { maxResponseMs: 100 },
    });

    expect(server.attempts()).toBe(2);
    const text = textOf(result);
    expect(text).toContain('PASS');
    expect(text).not.toContain('exceeds');
    await server.close();
  });

  it('passes a clean success on the first attempt', async () => {
    const server = await createCountingServer(() => ({
      status: 201,
      delayMs: 0,
      body: '{"id": 42}',
    }));

    const result = await validateHandler({
      url: `${server.baseUrl}/users`,
      assertions: [{ path: '$.id', match: { op: 'equals', expected: 42 } }],
    });

    expect(textOf(result)).toContain('PASS');
    await server.close();
  });
});

describe('chain handler', () => {
  it('runs steps, extracts variables, interpolates and asserts', async () => {
    const server = await createCountingServer((_attempt, method, _path, _body, headers) => {
      if (method === 'POST' && headers.authorization === 'Bearer abc') {
        return { status: 200, delayMs: 0, body: '{"authed":true}' };
      }
      if (method === 'POST') {
        return { status: 200, delayMs: 0, body: '{"token":"abc"}' };
      }
      return { status: 200, delayMs: 0, body: '{"id":1,"name":"ada"}' };
    });

    const result = await chainHandler({
      baseUrl: server.baseUrl,
      steps: [
        {
          name: 'login',
          request: { url: '/login', method: 'POST', body: '{"user":"u"}' },
          extract: { authToken: '$.token' },
          assertions: [{ path: '$.token', match: { op: 'equals', expected: 'abc' } }],
        },
        {
          name: 'profile',
          request: {
            url: '/me',
            method: 'POST',
            headers: { Authorization: 'Bearer {{authToken}}' },
          },
          assertions: [{ path: '$.authed', match: { op: 'equals', expected: true } }],
        },
      ],
    });

    expect(result.content[0].type).toBe('text');
    expect(textOf(result)).toContain('PASS');
    await server.close();
  });

  it('stops on a failing step when onFailure is stop (default)', async () => {
    const server = await createCountingServer(() => ({
      status: 404,
      delayMs: 0,
      body: '{}',
    }));

    const result = await chainHandler({
      baseUrl: server.baseUrl,
      steps: [
        {
          name: 'a',
          request: { url: '/a' },
          assertions: [{ path: '$.id', match: { op: 'exists' } }],
        },
        { name: 'b', request: { url: '/b' } },
      ],
    });

    expect(textOf(result)).toContain('FAIL');
    expect(server.attempts()).toBe(1); // stopped after first failed step
    await server.close();
  });
});
