import { createServer, type IncomingHttpHeaders } from 'node:http';
import { expect, test } from '@playwright/test';
import type {} from './main';

type CollectorRequest = {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};

type OtlpAttributes = { key: string; value: { stringValue?: string } }[];

type TraceRequest = {
  resourceSpans: {
    resource: { attributes: OtlpAttributes };
    scopeSpans: {
      spans: {
        name: string;
        parentSpanId?: string;
        traceId: string;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes: OtlpAttributes;
        events: unknown[];
        links: unknown[];
      }[];
    }[];
  }[];
};

for (const collectorMode of [
  'allowed',
  'denied',
  'anonymous-rejected',
  'same-origin',
]) {
  test(`export uses the configured webview collector with ${collectorMode} requests`, async ({
    page,
    context,
  }) => {
    const cors = collectorMode !== 'denied';
    let rejectedAnonymousBatches = 0;
    const requests: CollectorRequest[] = [];
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
        if (
          collectorMode === 'anonymous-rejected' &&
          path === '/v1/traces' &&
          body.includes('"name":"export.anonymous"')
        ) {
          rejectedAnonymousBatches++;
          response.writeHead(400).end('{}');
        } else if (count === 1) {
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
      const collector = `http://127.0.0.1:${address.port}`;
      await page.goto('/?document=synthetic-route');
      const sameOrigin = collectorMode === 'same-origin';
      if (sameOrigin) {
        await page.route('**/v1/**', async (route) => {
          const request = route.request();
          const { pathname } = new URL(request.url());
          const headers = await request.allHeaders();
          const response = await fetch(`${collector}${pathname}`, {
            method: request.method(),
            headers,
            body: request.postData(),
          });
          await route.fulfill({
            status: response.status,
            contentType: 'application/json',
            body: await response.text(),
          });
        });
      }
      await page.waitForFunction(
        () => typeof window.runExporterProbe === 'function'
      );
      const result = await page.evaluate(
        (collector) => window.runExporterProbe(collector),
        sameOrigin ? new URL(page.url()).origin : collector
      );
      expect(result.nativeCalls).toBe(0);
      expect(result.requests.length).toBeGreaterThan(0);
      expect(
        result.requests.every((request) => request.credentials === 'omit')
      ).toBe(true);
      if (!sameOrigin) {
        expect(
          result.requests.every((request) => request.mode === 'cors')
        ).toBe(true);
      }
      expect(result.failed).toBe(!cors);
      expect(rejectedAnonymousBatches).toBe(
        collectorMode === 'anonymous-rejected' ? 1 : 0
      );
      if (!cors) {
        expect(requests).toHaveLength(0);
        return;
      }
      expect(attempts.get('/v1/traces')).toBeGreaterThanOrEqual(2);
      expect(attempts.get('/v1/logs')).toBeGreaterThanOrEqual(2);
      expect(
        requests.every((request) => request.headers.cookie === undefined)
      ).toBe(true);
      const logs = requests.find((request) => request.path === '/v1/logs');
      expect(logs?.body).toContain('export.log');

      expectAnonymousTraceBatches(
        requests,
        sameOrigin ? page.url() : undefined
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
}

function expectAnonymousTraceBatches(
  requests: CollectorRequest[],
  pageReferrer?: string
): void {
  const batches = requests
    .filter((request) => request.path === '/v1/traces')
    .map(({ body, headers }) => {
      const { resourceSpans }: TraceRequest = JSON.parse(body);
      return resourceSpans.flatMap(({ resource, scopeSpans }) =>
        scopeSpans.flatMap(({ spans }) =>
          spans.map((span) => ({
            resource: resource.attributes,
            span,
            headers,
          }))
        )
      );
    });
  for (const batch of batches) {
    if (batch.some(({ span }) => span.name === 'export.anonymous')) {
      expect(batch.map(({ span }) => span.name)).toEqual(['export.anonymous']);
    }
  }
  const exported = batches.flat();
  const early = exported.find(({ span }) => span.name === 'export.early');
  const ready = exported.find(({ span }) => span.name === 'export.ready');
  const anonymous = exported.find(
    ({ span }) => span.name === 'export.anonymous'
  );
  expect(exported.map(({ span }) => span.name)).not.toContain(
    'export.anonymous_before_ready'
  );
  expect(ready).toBeDefined();
  expect(early?.resource).toEqual(
    expect.arrayContaining([
      {
        key: 'service.instance.id',
        value: { stringValue: 'synthetic-launch' },
      },
      {
        key: 'frontend_instance_id',
        value: { stringValue: 'synthetic-frontend' },
      },
    ])
  );
  expect(early?.span.attributes.map(({ key }) => key)).toEqual(
    expect.arrayContaining([
      'usr.id',
      'frontend_instance_id',
      'native_instance_id',
      'native_instance_id.end',
      'macro.recording.id',
    ])
  );
  expect(anonymous?.resource).toHaveLength(4);
  expect(anonymous?.resource).toEqual(
    expect.arrayContaining([
      {
        key: 'service.name',
        value: { stringValue: 'webview-export-probe' },
      },
      { key: 'deployment.environment', value: { stringValue: 'test' } },
      { key: 'service.version', value: { stringValue: 'test-release' } },
      { key: 'app.runtime', value: { stringValue: 'browser' } },
    ])
  );
  expect(anonymous?.span.attributes).toEqual([
    { key: 'bucket', value: { stringValue: 'coarse' } },
  ]);
  expect(anonymous?.span.traceId).not.toBe(ready?.span.traceId);
  expect(anonymous?.span.parentSpanId).toBeUndefined();
  if (pageReferrer) {
    expect(ready?.headers.referer).toBe(pageReferrer);
    expect(anonymous?.headers.referer).toBeUndefined();
  }
  expect(anonymous?.span.events).toEqual([]);
  expect(anonymous?.span.links).toEqual([]);
  expect(anonymous?.span.startTimeUnixNano).toBe(
    anonymous?.span.endTimeUnixNano
  );
}
