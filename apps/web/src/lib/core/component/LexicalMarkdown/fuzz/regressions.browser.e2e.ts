/**
 * Bugs the fuzzer found, as fixed scenarios. Each waits for the other
 * person's edit to reach the typist before checking, so they do not depend on
 * delivery timing.
 */

import { expect, test } from '@playwright/test';
import { openPeers } from './harness';
import { IMMEDIATE_DELIVERY, Relay } from './relay';

test('the caret after a line break stays there when someone else edits', async ({
  browser,
}) => {
  const relay = new Relay(IMMEDIATE_DELIVERY);
  const { peers, close } = await openPeers(
    browser,
    relay,
    'line-break-caret',
    2
  );
  const [alice, bob] = peers;

  await alice.page.keyboard.type('abc');
  await alice.page.keyboard.press('Shift+Enter');
  await bob.page.keyboard.type('x');
  await expect
    .poll(() => alice.api.evaluate((api) => api.editorMarkdown()))
    .toContain('Peer B:x');
  await alice.page.keyboard.type('xyz');

  await expect
    .poll(() => alice.api.evaluate((api) => api.blocks()[0]))
    .toEqual({ type: 'p', text: 'Peer A:abc\nxyz' });
  await close();
});

test('the caret on a new line of a code block stays there when someone else edits', async ({
  browser,
}) => {
  const relay = new Relay(IMMEDIATE_DELIVERY);
  const { peers, close } = await openPeers(
    browser,
    relay,
    'code-line-caret',
    2
  );
  const [alice, bob] = peers;

  await alice.page.keyboard.press('Enter');
  await alice.page.keyboard.type('```');
  await alice.page.keyboard.press('Enter');
  await alice.page.keyboard.type('abc');
  await alice.page.keyboard.press('Enter');
  await bob.page.keyboard.type('x');
  await expect
    .poll(() => alice.api.evaluate((api) => api.editorMarkdown()))
    .toContain('Peer B:x');
  await alice.page.keyboard.type('xyz');

  await expect
    .poll(() => alice.api.evaluate((api) => api.blocks()[1]))
    .toEqual({ type: 'code', text: 'abc\nxyz' });
  await close();
});

test('one undo takes back a word typed while someone else was typing', async ({
  browser,
}) => {
  const relay = new Relay(IMMEDIATE_DELIVERY);
  const { peers, close } = await openPeers(browser, relay, 'busy-undo', 2);
  const [alice, bob] = peers;

  const bobTyping = (async () => {
    for (let i = 0; i < 10; i++)
      await bob.page.keyboard.type('bob ', { delay: 15 });
  })();
  await alice.page.keyboard.type('hello world', { delay: 30 });
  await bobTyping;
  await expect
    .poll(() => alice.api.evaluate((api) => api.editorMarkdown()))
    .toContain(`Peer B:${'bob '.repeat(10)}`);
  await alice.page.keyboard.press('Control+z');

  await expect
    .poll(() => alice.api.evaluate((api) => api.blocks()[0]))
    .toEqual({ type: 'p', text: 'Peer A:' });
  await close();
});
