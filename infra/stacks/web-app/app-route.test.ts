import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const readFileSync = fs.readFileSync;
const templatePath = fileURLToPath(
  new URL('./appRouteLambda/index.html', import.meta.url)
);
mock.module('fs', () => ({
  ...fs,
  readFileSync: (...args: Parameters<typeof readFileSync>) =>
    args[0] === templatePath
      ? '<html><head></head><body>fixture</body></html>'
      : Reflect.apply(readFileSync, fs, args),
}));
const { handler } = await import('./appRouteLambda/index.mjs');
afterEach(() => mock.restore());

describe('app entry HTML cache headers', () => {
  test('channel entry HTML cannot be cached as an immutable asset', async () => {
    const response = await handler({
      rawPath: '/app/channel/test-channel',
      requestContext: { http: { path: '/app/channel/test-channel' } },
    });
    expect(response).toMatchObject({
      statusCode: '200',
      headers: { 'Cache-Control': 'no-store' },
    });
  });

  test('file-route errors are non-cacheable', async () => {
    const response = await handler({ rawPath: '/app/missing.js' });
    expect(response).toMatchObject({
      statusCode: '404',
      headers: { 'Cache-Control': 'no-store' },
    });
  });

  test('successful document previews keep HTML non-cacheable', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ previews: [{ document_name: 'Document' }] })
      )
    );
    const response = await handler({
      rawPath: '/app/md/test-document',
      requestContext: { http: { path: '/app/md/test-document' } },
    });
    expect(response).toMatchObject({
      statusCode: '200',
      headers: { 'Cache-Control': 'no-store' },
    });
  });

  test('fallback HTML remains non-cacheable when the preview service fails', async () => {
    spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('preview unavailable')
    );
    spyOn(console, 'error').mockImplementation(() => {});
    const response = await handler({
      rawPath: '/app/md/test-document',
      requestContext: { http: { path: '/app/md/test-document' } },
    });
    expect(response).toMatchObject({
      statusCode: '200',
      headers: { 'Cache-Control': 'no-store' },
    });
  });
});
