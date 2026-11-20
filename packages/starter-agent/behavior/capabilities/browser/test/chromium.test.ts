/**
 * The real thing: a Chromium Playwright drives through the area's `Tab`.
 * Runs when `chromium` is on PATH (the agent's image has it).
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  asTab,
  chromium,
  type Running,
} from '@macro-inc/muppet/utilities/browser';
import { type Browser, chromium as playwright } from 'playwright-core';
import { passthrough } from '../../../agent/claude.ts';
import { step } from '../browse.ts';

const available = Bun.which('chromium') !== null;
const port = 9437;

let profile = '';
let running: Running | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  if (!available) return;
  profile = await mkdtemp(join(tmpdir(), 'agent-browser-'));
  running = await chromium({ profile, port });
  browser = await playwright.connectOverCDP(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  await browser?.close();
  await running?.stop();
  if (profile !== '') await rm(profile, { recursive: true, force: true });
});

test.skipIf(!available)(
  'fills a login form, presses a key, clicks, and reads the result',
  async () => {
    const page = browser?.contexts()[0]?.pages().at(-1);
    if (page === undefined) throw new Error('no page');
    await page.setContent(`
      <form onsubmit="event.preventDefault(); document.body.innerText = 'Hi ' + user.value">
        <input id="user"><input id="password" type="password">
        <button>Sign in</button>
      </form>`);
    const tab = asTab(page);
    const trace = passthrough;
    await step(
      { tab, trace },
      { kind: 'type', selector: '#user', text: 'ada' }
    );
    await step({ tab, trace }, { kind: 'click', text: 'Sign in' });
    const read = await step({ tab, trace }, { kind: 'read' });
    expect(read.text).toContain('Hi ada');
    const shot = join(profile, 'page.png');
    await step({ tab, trace }, { kind: 'screenshot', path: shot });
    expect([...(await Bun.file(shot).bytes()).subarray(1, 4)]).toEqual([
      0x50, 0x4e, 0x47,
    ]);
  }
);

test.skipIf(!available)(
  'pastes the clipboard into a field, so a vault secret never passes through the agent',
  async () => {
    const context = browser?.contexts()[0];
    const page = context?.pages().at(-1);
    if (context === undefined || page === undefined) throw new Error('no page');
    await page.goto(`http://127.0.0.1:${port}/json/version`);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setContent('<input id="password" type="password">');
    // What copySecret does on the computer with xclip, done here by the page.
    await page.evaluate("navigator.clipboard.writeText('s3cret-value')");
    await step(
      { tab: asTab(page), trace: passthrough },
      { kind: 'paste', selector: '#password' }
    );
    expect(await page.inputValue('#password')).toBe('s3cret-value');
  }
);
