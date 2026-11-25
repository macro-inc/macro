/**
 * The browser's network layer on its own, without the request allowlist:
 * only the lab origin is reachable.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { hostEnvironment } from '../src/browser-options.ts';
import { LAB_HOST, LAB_PORT } from '../src/registry.ts';

const PROBE = join(import.meta.dir, 'network-probe.ts');

let outsideHits = 0;
let outside: ReturnType<typeof Bun.serve>;
let lab: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  outside = Bun.serve({
    hostname: '127.0.0.2',
    port: 47832,
    fetch: () => {
      outsideHits += 1;
      return new Response('outside');
    },
  });
  lab = Bun.serve({
    hostname: LAB_HOST,
    port: LAB_PORT,
    fetch: () => new Response('lab'),
  });
});

afterAll(async () => {
  await outside.stop(true);
  await lab.stop(true);
});

test('only the lab origin is reachable, even with no allowlist', async () => {
  const env = hostEnvironment();
  const probe = Bun.spawn(
    [Bun.which('node', { PATH: env.PATH ?? '' }) ?? 'node', PROBE],
    {
      env: {
        ...env,
        ...(process.env.LAB_CHROMIUM_PATH === undefined
          ? {}
          : { LAB_CHROMIUM_PATH: process.env.LAB_CHROMIUM_PATH }),
      },
      stdout: 'pipe',
    }
  );

  expect(await probe.exited).toBe(0);
  const result = JSON.parse(await new Response(probe.stdout).text());
  expect(result).toEqual({ lab: 'lab' });
  expect(outsideHits).toBe(0);
}, 60_000);

test('the browser gets only an allowlisted environment', () => {
  const saved = {
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
    LAB_TEST_SECRET: process.env.LAB_TEST_SECRET,
  };
  process.env.LD_LIBRARY_PATH = '/nix/store/not-for-chromium/lib';
  process.env.LAB_TEST_SECRET = 'not-for-the-browser';
  try {
    const env = hostEnvironment();

    expect(env.LD_LIBRARY_PATH).toBeUndefined();
    expect(env.LAB_TEST_SECRET).toBeUndefined();
    expect(
      Object.keys(env).every((name) =>
        [
          'HOME',
          'PATH',
          'TMPDIR',
          'LANG',
          'TZ',
          'FONTCONFIG_FILE',
          'FONTCONFIG_PATH',
        ].includes(name)
      )
    ).toBe(true);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
