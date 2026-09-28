import { describe, expect, it } from 'bun:test';
import { parseArguments, SyncServiceAdmin } from './dump-do-state';

describe('dump credentials stay on the intended origin', () => {
  it('keeps the default production origin', () => {
    expect(parseArguments(['doc']).baseUrl).toBe(
      'https://sync-service-prod2.macroverse.workers.dev'
    );
  });

  it('requires an explicit key for a custom origin', () => {
    expect(() =>
      parseArguments(['doc', '--url', 'https://example.com'])
    ).toThrow('--url requires an explicit --key');
  });

  it('requires playground credentials instead of falling back to local', () => {
    expect(() => parseArguments(['doc', '--env', 'playground'])).toThrow(
      '--env playground requires an explicit --key'
    );
  });

  it.each([
    'http://example.com',
    'ftp://example.com',
    'http://localhost.example.com',
  ])('rejects insecure non-loopback origin %s', (url) => {
    expect(() =>
      parseArguments(['doc', '--url', url, '--key', 'test-key'])
    ).toThrow('requires HTTPS');
  });

  it.each([
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://[::1]:8787',
    'https://example.com',
  ])('accepts an explicit key for %s', (url) => {
    expect(
      parseArguments(['doc', '--url', `${url}/`, '--key', 'test-key']).baseUrl
    ).toBe(url);
  });

  it.each([
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com/?query=1',
    'https://example.com/#fragment',
  ])('rejects a URL that is not just an origin: %s', (url) => {
    expect(() =>
      parseArguments(['doc', '--url', url, '--key', 'test-key'])
    ).toThrow('must be an origin');
  });
});

describe('document existence checks', () => {
  it.each([200, 404, 401, 403, 500])(
    'handles status %i without hiding errors',
    async (status) => {
      using server = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status }),
      });
      const client = new SyncServiceAdmin(server.url.origin, 'doc', 'test-key');
      if (status === 200 || status === 404) {
        expect(await client.exists()).toBe(status === 200);
      } else {
        await expect(client.exists()).rejects.toThrow(
          `/exists returned ${status}`
        );
      }
    }
  );

  it('does not forward the admin key to a redirect target', async () => {
    let forwarded = false;
    using target = Bun.serve({
      port: 0,
      fetch: () => {
        forwarded = true;
        return new Response(null);
      },
    });
    using source = Bun.serve({
      port: 0,
      fetch: () => Response.redirect(target.url),
    });
    const client = new SyncServiceAdmin(source.url.origin, 'doc', 'test-key');
    await expect(client.exists()).rejects.toThrow();
    expect(forwarded).toBe(false);
  });
});
