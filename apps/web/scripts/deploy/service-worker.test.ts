import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function worker(fetch: typeof globalThis.fetch) {
  return runInNewContext(
    `${readFileSync(resolve(import.meta.dirname, '../../public/sw.js'), 'utf8')}\nfetchAsset`,
    {
      URL,
      fetch,
      self: {
        registration: { scope: 'https://example.com/app/' },
        addEventListener() {},
      },
    }
  ) as (request: Request) => Promise<Response>;
}

describe('service worker HTTP cache recovery', () => {
  const request = new Request(
    'https://example.com/app/route-views-DDzkOi-U.js'
  );
  it.each([403, 404])(
    'bypasses a cached %s and returns the recovered asset',
    async (status) => {
      const recovered = new Response('export default 1');
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response('missing', { status }))
        .mockResolvedValueOnce(recovered);
      expect(await worker(fetch)(request)).toBe(recovered);
      expect(fetch.mock.calls).toEqual([
        [request],
        [request, { cache: 'reload' }],
      ]);
    }
  );
  it('does not refetch successful assets', async () => {
    const response = new Response('export default 1');
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    expect(await worker(fetch)(request)).toBe(response);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('returns a genuine missing-file error after one retry without a loop', async () => {
    const response = new Response('missing', { status: 403 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    expect(await worker(fetch)(request)).toBe(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not retry an offline/network failure', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError('offline'));
    await expect(worker(fetch)(request)).rejects.toThrow('offline');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
