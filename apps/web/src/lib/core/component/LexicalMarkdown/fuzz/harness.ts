/** Opening people on a fuzz document and pressing their keys. */

import type { Browser, BrowserContext, JSHandle, Page } from '@playwright/test';
import { match } from 'ts-pattern';
import type { FuzzWindow, LexFuzzApi } from './bridge';
import type { Key } from './model';
import type { Relay } from './relay';

const NAMES = 'ABCDEFGH';
/** A last block nobody types into. */
export const END_MARKER = 'The end.';

export type Peer = {
  name: string;
  page: Page;
  api: JSHandle<LexFuzzApi>;
};

/** The page's `LexFuzzApi`, once the fixture has published it. */
async function peerApi(page: Page): Promise<JSHandle<LexFuzzApi>> {
  await page.waitForFunction(
    () => {
      const fuzzWindow: FuzzWindow = window;
      return fuzzWindow.lexFuzz !== undefined;
    },
    undefined,
    { timeout: 120_000 }
  );
  return page.evaluateHandle(() => {
    const fuzzWindow: FuzzWindow = window;
    const api = fuzzWindow.lexFuzz;
    if (!api) throw new Error('the fixture did not publish lexFuzz');
    return api;
  });
}

/** The marker paragraph each person types after. */
export const markerOf = (name: string) => `Peer ${name}:`;

/**
 * Opens `count` people (A, B, ...) on a new document, each in a browser
 * context of their own, with the caret at the end of their marker paragraph.
 */
export async function openPeers(
  browser: Browser,
  relay: Relay,
  documentId: string,
  count: number
): Promise<{ peers: Peer[]; close: () => Promise<void> }> {
  const contexts: BrowserContext[] = [];
  const close = async () => {
    await Promise.all(contexts.map((context) => context.close()));
  };
  try {
    const peers = await loadPeers(browser, relay, documentId, count, contexts);
    return { peers, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function loadPeers(
  browser: Browser,
  relay: Relay,
  documentId: string,
  count: number,
  contexts: BrowserContext[]
): Promise<Peer[]> {
  const pages: { name: string; page: Page }[] = [];
  for (const name of NAMES.slice(0, count)) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    if (process.env.FUZZ_DEBUG)
      page.on('console', (message) =>
        console.log(`[${name}] ${message.type()}: ${message.text()}`)
      );
    page.on('pageerror', (error) =>
      console.log(`[${name}] pageerror: ${error.message}`)
    );
    await relay.attach(name, page);
    pages.push({ name, page });
  }
  // A last block nobody types into, so no region ends the document (where
  // trailingParagraphPlugin adds a paragraph after a code block).
  const markdown = [
    ...pages.map(({ name }) => markerOf(name)),
    END_MARKER,
  ].join('\n\n');
  await Promise.all(pages.map(({ page }) => page.goto(`/?doc=${documentId}`)));
  const peers = await Promise.all(
    pages.map(async ({ name, page }) => ({
      name,
      page,
      api: await peerApi(page),
    }))
  );
  for (const peer of peers) relay.connect(peer.name, peer.api);
  relay.initialize(
    await peers[0].api.evaluate((api, seed) => api.seed(seed), markdown)
  );
  for (const peer of peers) {
    await peer.page.waitForFunction((api) => api.ready(), peer.api, {
      timeout: 30_000,
    });
    const placed = await peer.api.evaluate(
      (api, marker) => api.placeAtEnd(marker),
      markerOf(peer.name)
    );
    if (!placed) throw new Error(`${peer.name} could not find its marker`);
  }
  return peers;
}

export async function press(page: Page, key: Key): Promise<void> {
  const keyboard = page.keyboard;
  await match(key)
    .with({ kind: 'type' }, ({ text, delay }) => keyboard.type(text, { delay }))
    .with({ kind: 'enter' }, () => keyboard.press('Enter'))
    .with({ kind: 'linebreak' }, () => keyboard.press('Shift+Enter'))
    .with({ kind: 'backspace' }, () => keyboard.press('Backspace'))
    .with({ kind: 'shortcut' }, ({ prefix }) => keyboard.type(prefix))
    .with({ kind: 'code' }, async () => {
      await keyboard.type('```');
      await keyboard.press('Enter');
    })
    .exhaustive();
}
