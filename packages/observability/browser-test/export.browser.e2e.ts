import { createServer, type IncomingHttpHeaders } from 'node:http';
import { expect, test } from '@playwright/test';
import type {} from './main';

for (const cors of [true, false]) {
  test(`export uses the configured webview collector with CORS ${cors ? 'allowed' : 'denied'}`, async ({
    page,
    context,
  }) => {
    const requests: {
      path: string;
      headers: IncomingHttpHeaders;
      body: string;
    }[] = [];
    const attempts = new Map<string, number>();
    const server = createServer((request, response) => {
      if (cors) {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Headers', 'content-type');
        response.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end();
        return;
      }
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        const path = request.url ?? '';
        const count = (attempts.get(path) ?? 0) + 1;
        attempts.set(path, count);
        requests.push({ path, headers: request.headers, body });
        response.setHeader('Content-Type', 'application/json');
        if (count === 1) {
          response.setHeader('Retry-After', '0');
          response.writeHead(503).end('{}');
        } else response.writeHead(200).end('{}');
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No collector');
    try {
      await context.addCookies([
        {
          name: 'probe-session',
          value: 'private',
          domain: '127.0.0.1',
          path: '/',
        },
      ]);
      await page.goto('/');
      await page.waitForFunction(
        () => typeof window.runExporterProbe === 'function'
      );
      const result = await page.evaluate(
        (collector) => window.runExporterProbe(collector),
        `http://127.0.0.1:${address.port}`
      );
      expect(result.nativeCalls).toBe(0);
      expect(result.requests.length).toBeGreaterThan(0);
      expect(
        result.requests.every((request) => request.credentials === 'omit')
      ).toBe(true);
      expect(result.requests.every((request) => request.mode === 'cors')).toBe(
        true
      );
      expect(result.failed).toBe(!cors);
      if (!cors) {
        expect(requests).toHaveLength(0);
        return;
      }
      expect(attempts.get('/v1/traces')).toBeGreaterThanOrEqual(2);
      expect(attempts.get('/v1/logs')).toBeGreaterThanOrEqual(2);
      expect(
        requests.every((request) => request.headers.cookie === undefined)
      ).toBe(true);
      const traces = requests.find((request) => request.path === '/v1/traces');
      const logs = requests.find((request) => request.path === '/v1/logs');
      expect(traces?.body).toContain('export.early');
      expect(traces?.body).toContain('export.ready');
      expect(logs?.body).toContain('export.log');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
}
