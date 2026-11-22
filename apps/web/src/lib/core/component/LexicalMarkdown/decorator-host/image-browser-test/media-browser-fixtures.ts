import { createServer, type ServerResponse } from 'node:http';
import type { BrowserContext } from '@playwright/test';

export const url = 'https://static.klipy.com/fixture/image.svg';
export const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect width="256" height="128" fill="#456789"/></svg>';

export async function routeFixtures(context: BrowserContext) {
  await context.route('**/__macro_dev/gateway/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/email/links')
      ? route.fulfill({ json: { links: [] } })
      : route.fulfill({
          status: 403,
          json: { message: 'Fixture access denied' },
        })
  );
  await context.route('https://static.klipy.com/fixture/image.svg*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: svg,
    })
  );
}

// Capture the actual browser PUT bytes over HTTP, including WebKit Blob bodies.
export async function receiveUpload(status: number) {
  let resolveBody: (bytes: Buffer) => void;
  const body = new Promise<Buffer>((resolve) => {
    resolveBody = resolve;
  });
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'PUT, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
  };
  let response: ServerResponse | undefined;
  let released = false;
  let count = 0;
  const finish = () => {
    if (!released || !response) return;
    response.writeHead(status, cors).end();
    response = undefined;
  };
  const server = createServer((request, reply) => {
    if (request.method === 'OPTIONS') {
      reply.writeHead(204, cors).end();
      return;
    }
    if (request.method !== 'PUT') {
      reply.writeHead(405, cors).end();
      return;
    }
    count++;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      response = reply;
      resolveBody(Buffer.concat(chunks));
      finish();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Missing upload receiver port');
  }
  return {
    body,
    url: `http://127.0.0.1:${address.port}/fixture-upload`,
    requests: () => count,
    release() {
      released = true;
      finish();
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
