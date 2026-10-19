/** Opening people on a fuzz document and pressing their keys. */

import type { Browser, Page } from '@playwright/test';
import { match } from 'ts-pattern';
import { type Action, PeerModel } from './model';
import type { Relay } from './relay';

const NAMES = 'ABCDEFGH';
/** A last block nobody types into. */
export const END_MARKER = 'The end.';

export type Peer = {
  name: string;
  page: Page;
  model: PeerModel;
  log: Action[];
};

/**
 * Opens `count` people (A, B, ...) on a new document, each in a browser
 * context of their own, with the caret at the end of their marker paragraph.
 */
export async function openPeers(
  browser: Browser,
  relay: Relay,
  documentId: string,
  count: number
): Promise<Peer[]> {
  const peers: Peer[] = [];
  for (let i = 0; i < count; i++) {
    const name = NAMES[i];
    const context = await browser.newContext();
    const page = await context.newPage();
    if (process.env.FUZZ_DEBUG)
      page.on('console', (m) =>
        console.log(`[${name}] ${m.type()}: ${m.text()}`)
      );
    page.on('pageerror', (e) =>
      console.log(`[${name}] pageerror: ${e.message}`)
    );
    await relay.attach(name, page);
    peers.push({ name, page, model: new PeerModel(`Peer ${name}:`), log: [] });
  }
  // A last block nobody types into, so no region ends the document (where
  // trailingParagraphPlugin adds a paragraph after a code block).
  const markdown = [...peers.map((p) => p.model.marker), END_MARKER].join(
    '\n\n'
  );
  await Promise.all(peers.map((p) => p.page.goto(`/?doc=${documentId}`)));
  await peers[0].page.waitForFunction(
    () => window.lexFuzz !== undefined,
    undefined,
    { timeout: 120_000 }
  );
  if (process.env.FUZZ_DEBUG) console.log('fixture loaded');
  relay.initialize(
    await peers[0].page.evaluate((md) => window.lexFuzz!.seed(md), markdown)
  );
  if (process.env.FUZZ_DEBUG) console.log('server seeded');
  for (const peer of peers) {
    await peer.page.waitForFunction(
      () => window.lexFuzz?.ready() === true,
      undefined,
      { timeout: 30_000 }
    );
    const placed = await peer.page.evaluate(
      (m) => window.lexFuzz!.placeAtEnd(m),
      peer.model.marker
    );
    if (!placed) throw new Error(`${peer.name} could not find its marker`);
  }
  return peers;
}

export async function perform(
  peer: Peer,
  relay: Relay,
  action: Action
): Promise<void> {
  const keyboard = peer.page.keyboard;
  await match(action)
    .with({ kind: 'type' }, ({ text, delay }) => keyboard.type(text, { delay }))
    .with({ kind: 'enter' }, () => keyboard.press('Enter'))
    .with({ kind: 'linebreak' }, () => keyboard.press('Shift+Enter'))
    .with({ kind: 'backspace' }, () => keyboard.press('Backspace'))
    .with({ kind: 'shortcut' }, ({ prefix }) => keyboard.type(prefix))
    .with({ kind: 'code' }, async () => {
      await keyboard.type('```');
      await keyboard.press('Enter');
    })
    .with({ kind: 'offline' }, async () => relay.hold(peer.name))
    .with({ kind: 'online' }, async () => relay.release(peer.name))
    .with({ kind: 'pause' }, ({ ms }) => peer.page.waitForTimeout(ms))
    .exhaustive();
}
