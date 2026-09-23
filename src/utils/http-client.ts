import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { PACKAGE_NAME, VERSION } from './package.js';

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  maxRedirects?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  timingMs: number;
  ttfbMs: number;
  finalUrl: string;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_REDIRECTS = 5;

export function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const timeout = req.timeout ?? DEFAULT_TIMEOUT;
    const maxRedirects = req.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const start = Date.now();

    const doRequest = (urlStr: string, redirectsUsed: number) => {
      let parsed: URL;
      try {
        parsed = new URL(urlStr);
      } catch (err) {
        reject(new Error(`Invalid URL: ${urlStr}`));
        return;
      }

      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const clientStart = Date.now();
      let ttfbMs = 0;
      let headerRecord: Record<string, string> = {};
      let bodyChunks: Buffer[] = [];
      let settled = false;

      const done = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      const method = (req.method ?? 'GET').toUpperCase();
      const hasBody = req.body !== undefined && req.body !== '';

      const headers: Record<string, string> = {
        Accept: '*/*',
        'User-Agent': `${PACKAGE_NAME}/${VERSION}`,
        ...(req.headers ?? {}),
      };

      if (hasBody) {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(req.body ?? ''));
      }

      const options: http.RequestOptions = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
      };

      const clientReq = lib.request(options, (res) => {
        const status = res.statusCode ?? 0;
        const rawHeaders: Record<string, string> = {};
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          const key = res.rawHeaders[i];
          const val = res.rawHeaders[i + 1];
          if (!(key.toLowerCase() in rawHeaders)) {
            rawHeaders[key] = val;
          }
        }
        headerRecord = rawHeaders;
        ttfbMs = Date.now() - clientStart;

        if (status >= 300 && status < 400 && res.headers.location && redirectsUsed < maxRedirects) {
          res.resume();
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          doRequest(nextUrl, redirectsUsed + 1);
          return;
        }

        res.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
        res.on('end', () => {
          if (settled) return;
          const body = Buffer.concat(bodyChunks).toString('utf-8');
          done(() =>
            resolve({
              status,
              headers: headerRecord,
              body,
              timingMs: Date.now() - start,
              ttfbMs,
              finalUrl: urlStr,
            })
          );
        });
        res.on('error', (err) => done(() => reject(err)));
      });

      if (hasBody) clientReq.write(req.body);
      clientReq.end();

      const timer = setTimeout(() => {
        clientReq.destroy();
        done(() => reject(new Error(`Request timed out after ${timeout}ms (${method} ${urlStr})`)));
      }, timeout);
      timer.unref?.();

      clientReq.on('error', (err) => {
        clearTimeout(timer);
        done(() => reject(err));
      });
    };

    doRequest(req.url, 0);
  });
}

export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function statusClass(status: number): number {
  return Math.floor(status / 100);
}
