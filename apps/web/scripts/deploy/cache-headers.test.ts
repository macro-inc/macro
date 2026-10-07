import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type EdgeResponse = {
  statusCode: number;
  headers: Record<string, { value: string }>;
};
const handler = runInNewContext(
  `${readFileSync(resolve(import.meta.dirname, '../../../../infra/stacks/website/appCache/handler.js'), 'utf8')}\nhandler`
) as (event: {
  request: { uri: string };
  response: EdgeResponse;
}) => EdgeResponse;

function cacheControl(uri: string, statusCode: number) {
  // The response policy runs for all statuses, before the viewer function.
  const response: EdgeResponse = {
    statusCode,
    headers: { 'cache-control': { value: 'no-store' } },
  };
  // CloudFront skips viewer-response functions entirely for origin errors.
  if (statusCode < 400) handler({ request: { uri }, response });
  return response.headers['cache-control'].value;
}

describe('app CDN cache headers', () => {
  it.each([200, 304])(
    'caches successful immutable assets at status %s',
    (status) => {
      expect(cacheControl('/app/route-views-DDzkOi-U.js', status)).toBe(
        'public, max-age=31536000, immutable'
      );
      expect(cacheControl('/app/assets/app-BkGDZxxC.css', status)).toBe(
        'public, max-age=31536000, immutable'
      );
    }
  );
  it.each([403, 404, 500, 503, 302, 206])(
    'never turns status %s into a long-lived response',
    (status) => {
      expect(cacheControl('/app/route-views-DDzkOi-U.js', status)).toBe(
        'no-store'
      );
    }
  );
  it.each([
    '/app/index.html',
    '/app/sw.js',
    '/app/app-archive.zip',
    '/app/manifest.json',
  ])('does not cache mutable %s', (path) => {
    expect(cacheControl(path, 200)).toBe('no-store');
  });
});
