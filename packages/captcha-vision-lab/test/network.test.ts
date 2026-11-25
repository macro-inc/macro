/**
 * The browser's network layer on its own, without the request allowlist:
 * only the lab origin is reachable.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { LAB_HOST, LAB_PORT, LAB_URL } from '../src/registry.ts';
import { isolatedBrowser } from '../src/run.ts';

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
  const profile = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-test-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.LAB_CHROMIUM_PATH,
    ...isolatedBrowser(),
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());

    const response = await page.goto(LAB_URL);
    expect(await response?.text()).toBe('lab');

    // Each in its own page, so one's error page can't interrupt the next.
    for (const url of [
      'http://127.0.0.2:47832/',
      `http://localhost:${LAB_PORT}/`,
    ]) {
      const other = await context.newPage();
      await expect(other.goto(url)).rejects.toThrow();
      await other.close();
    }

    expect(outsideHits).toBe(0);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('the browser gets only an allowlisted environment', () => {
  const saved = {
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
    LAB_TEST_SECRET: process.env.LAB_TEST_SECRET,
  };
  process.env.LD_LIBRARY_PATH = '/nix/store/not-for-chromium/lib';
  process.env.LAB_TEST_SECRET = 'not-for-the-browser';
  try {
    const { env } = isolatedBrowser();

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
