import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockRoute {
  path: string;
  method?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delayMs?: number;
}

export interface MockServer {
  baseUrl: string;
  requests: { method: string; path: string; body: string }[];
  close: () => Promise<void>;
}

function serializeBody(body: unknown): string {
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

export function createMockServer(routes: MockRoute[]): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const requests: MockServer['requests'] = [];

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        const pathOnly = (req.url ?? '/').split('?')[0];
        requests.push({ method: req.method ?? 'GET', path: pathOnly, body });

        const route =
          routes.find((r) => r.path === pathOnly && (!r.method || r.method === req.method)) ??
          routes.find((r) => r.path === '/__any__');

        const status = route?.status ?? 200;
        const respBody = serializeBody(route?.body ?? { ok: true });
        const headers = {
          'Content-Type': 'application/json',
          ...(route?.headers ?? {}),
          'Content-Length': Buffer.byteLength(respBody),
        };

        const send = () => {
          res.writeHead(status, headers);
          res.end(respBody);
        };

        if (route?.delayMs) {
          setTimeout(send, route.delayMs);
        } else {
          send();
        }
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        requests,
        close: () => new Promise<void>((resDone) => server.close(() => resDone())),
      });
    });
  });
}
