import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium as playwright } from 'playwright-core';
import { browser, chromium, type Running } from '../index.ts';

const available = Bun.which('chromium') !== null;

describe.skipIf(!available)('chromium', () => {
  let profile = '';
  let running: Running | undefined;

  beforeAll(async () => {
    profile = await mkdtemp(join(tmpdir(), 'muppet-browser-'));
    running = await chromium({ profile, port: 9411 });
  });

  afterAll(async () => {
    await running?.stop();
    await rm(profile, { recursive: true, force: true });
  });

  test('starts a browser Playwright can drive: pages, clicks, JavaScript, screenshots', async () => {
    const endpoint = running?.endpoint ?? '';
    expect(endpoint).toStartWith('ws://127.0.0.1:9411/devtools/browser/');

    const connected = await playwright.connectOverCDP(endpoint);
    const context = await connected.newContext();
    const page = await context.newPage();
    await page.setContent(
      `<title>Hi</title><button onclick="document.title='clicked'">Go</button>`
    );
    await page.getByRole('button', { name: 'Go' }).click();
    expect(await page.title()).toBe('clicked');
    const png = await page.screenshot();
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    await context.close();
    await connected.close();
  });

  test('puts the endpoint in the context, and lists the tools in the catalog', () => {
    const used = browser({ endpoint: running?.endpoint ?? '' });
    expect(used.decorations.browser.endpoint).toBe(running?.endpoint ?? '');
    expect(Object.keys(used.capabilities)).toEqual([
      'playwright-core',
      'ffmpeg',
    ]);
  });
});
