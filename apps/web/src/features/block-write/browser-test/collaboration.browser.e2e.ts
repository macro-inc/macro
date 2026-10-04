import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import type { Miniflare } from 'miniflare';
import { fixtureUrl, startSyncServer } from './sync-server';

let server: Miniflare;
let serverUrl: string;
// The sync Worker allows localhost origins (ports 3000-3999).
const BASE = 'http://localhost:3018';
const ALICE = 'macro|alice@example.com';
const BOB = 'macro|bob@example.com';
const SHOTS = process.env.DOCX_E2E_SHOTS;

test.beforeAll(async () => {
  ({ server, url: serverUrl } = await startSyncServer());
});
test.afterAll(async () => {
  await server?.dispose();
});

async function open(page: Page, documentId: string, user: string, extra = {}) {
  // Text painted by the comment highlights, for assertions.
  await page.addInitScript(() => {
    globalThis.highlightedText = () =>
      Array.from(CSS.highlights.values())
        .flatMap((highlight) => Array.from(highlight))
        .map((range) => range.toString())
        .join('\n');
  });
  await page.goto(fixtureUrl(BASE, serverUrl, documentId, user, extra));
  await expect
    .poll(() => page.evaluate(() => window.docxFixture?.ready() ?? false), {
      timeout: 60_000,
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.docxFixture?.status()))
    .toBe('connected');
}

const paragraphs = (page: Page) =>
  page.evaluate(() => window.docxFixture?.paragraphs() ?? []);

/** The editable paragraph whose text starts with `prefix`. */
const paragraph = (page: Page, prefix: string) =>
  page
    .locator('.docx-body-flow [data-anchor][contenteditable="true"]')
    .filter({ hasText: prefix })
    .first();

/** Select a whole paragraph's text, as a user dragging across it would. */
async function selectParagraph(page: Page, prefix: string) {
  await paragraph(page, prefix).click();
  await page.evaluate((text) => {
    const block = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.docx-body-flow [data-anchor][contenteditable="true"]'
      )
    ).find((element) => element.textContent?.includes(text));
    if (!block) throw new Error(`no paragraph ${text}`);
    const range = document.createRange();
    range.selectNodeContents(block);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, prefix);
}

/** Computed weight of the first text run in the paragraph containing `text`. */
const fontWeightAt = (page: Page, text: string) =>
  page.evaluate((needle) => {
    const block = Array.from(
      document.querySelectorAll<HTMLElement>('.docx-body-flow [data-anchor]')
    ).find((element) => element.textContent?.includes(needle));
    const walker =
      block && document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const node = walker?.nextNode();
    return node?.parentElement
      ? getComputedStyle(node.parentElement).fontWeight
      : '';
  }, text);

declare global {
  function highlightedText(): string;
}

async function caretAtEnd(page: Page, prefix: string) {
  const target = paragraph(page, prefix);
  await target.click();
  await page.keyboard.press('End');
}

test('two people edit the same DOCX live through the sync service', async ({
  browser,
}) => {
  const documentId = crypto.randomUUID();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, bob] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  for (const page of [alice, bob])
    page.on('console', (message) => {
      if (message.type() === 'error')
        console.log(`[${page === alice ? 'alice' : 'bob'}]`, message.text());
    });
  try {
    // Alice opens an unseen document: her client seeds it from the upload.
    await open(alice, documentId, ALICE);
    await open(bob, documentId, BOB);
    expect(await paragraphs(bob)).toEqual(await paragraphs(alice));
    if (SHOTS) await alice.screenshot({ path: `${SHOTS}/01-opened.png` });

    // Typing is committed while Alice pauses and reaches Bob without a blur.
    await caretAtEnd(alice, 'This Agreement shall remain');
    await alice.keyboard.type(' Renewal requires mutual written consent.');
    await expect
      .poll(async () => (await paragraphs(bob)).join('\n'))
      .toContain('Renewal requires mutual written consent.');

    // Concurrent edits to different paragraphs both survive.
    await caretAtEnd(alice, '"Representatives" means');
    await alice.keyboard.type(' [alice]');
    await caretAtEnd(bob, 'This Agreement shall be governed');
    await bob.keyboard.type(' [bob]');
    await alice.locator('body').press('Escape');
    for (const page of [alice, bob]) {
      await expect
        .poll(async () => (await paragraphs(page)).join('\n'))
        .toContain('[alice]');
      await expect
        .poll(async () => (await paragraphs(page)).join('\n'))
        .toContain('[bob]');
    }

    // Enter splits a paragraph for everyone.
    const before = (await paragraphs(alice)).length;
    await caretAtEnd(bob, 'IN WITNESS WHEREOF');
    await bob.keyboard.press('Enter');
    await bob.keyboard.type('Signed by the parties below.');
    await expect
      .poll(async () => (await paragraphs(alice)).length)
      .toBe(before + 1);
    await expect
      .poll(async () => (await paragraphs(alice)).join('\n'))
      .toContain('Signed by the parties below.');

    // Each sees the other's caret.
    await expect(alice.locator('[data-docx-peer]')).toHaveCount(1);
    await expect(alice.locator('[data-docx-peer]')).toContainText('Bob');
    if (SHOTS)
      await alice.screenshot({ path: `${SHOTS}/02-collaborating.png` });

    // Toolbar formatting propagates.
    await selectParagraph(alice, 'This Agreement shall be governed');
    await alice.getByRole('button', { name: 'Bold' }).click();
    await expect
      .poll(() => fontWeightAt(bob, 'This Agreement shall be governed'))
      .toBe('700');

    // A list toggle changes the numbering part: Bob's editor remounts on it.
    await paragraph(alice, '"Confidential Information" means').click();
    await alice.getByRole('button', { name: 'Bulleted list' }).click();
    await expect
      .poll(() =>
        bob.evaluate(
          () =>
            Array.from(
              document.querySelectorAll('.docx-body-flow [data-list-marker]')
            ).length
        )
      )
      .toBeGreaterThan(3);

    // Comments: select any line, comment, and the thread appears beside it
    // for both collaborators, with the text highlighted.
    await selectParagraph(alice, 'Each party shall use');
    await alice.getByRole('button', { name: 'Comment on selection' }).click();
    await alice
      .getByRole('textbox', { name: 'Comment text' })
      .fill('Limit this to the evaluation period?');
    await alice.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect
      .poll(() =>
        bob.evaluate(
          () => Object.keys(window.docxFixture?.marks() ?? {}).length
        )
      )
      .toBe(1);
    for (const page of [alice, bob]) {
      await expect(page.locator('[data-docx-thread]')).toContainText(
        'Limit this to the evaluation period?'
      );
      await expect
        .poll(() => page.evaluate(() => highlightedText()))
        .toContain('Each party shall use the Confidential Information');
    }
    // The floating button comments on a selection inside a table cell too.
    await selectParagraph(bob, 'Retainer');
    await bob
      .locator(
        '[data-docx-comment-button] button, button[data-docx-comment-button]'
      )
      .first()
      .click();
    await bob
      .getByRole('textbox', { name: 'Comment text' })
      .fill('Confirm the retainer amount.');
    await bob.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(alice.locator('[data-docx-thread]')).toHaveCount(2);
    // Edits to commented text keep the thread on it.
    await caretAtEnd(alice, 'Each party shall use');
    await alice.keyboard.type(' during the term');
    await expect
      .poll(() => bob.evaluate(() => highlightedText()), { timeout: 30_000 })
      .toContain(
        'evaluating a potential business relationship between the parties.'
      );
    if (SHOTS) await bob.screenshot({ path: `${SHOTS}/03-comments.png` });

    // Download produces a clean .docx carrying everyone's edits.
    const [download] = await Promise.all([
      bob.waitForEvent('download'),
      bob.getByRole('button', { name: 'Download .docx' }).click(),
    ]);
    if (SHOTS) await download.saveAs(`${SHOTS}/edited.docx`);
    const files = unzipSync(
      new Uint8Array(await readFile((await download.path())!))
    );
    const documentXml = strFromU8(files['word/document.xml']);
    expect(documentXml).toContain('Renewal requires mutual written consent.');
    expect(documentXml).toContain('Signed by the parties below.');
    expect(documentXml).not.toContain('Unid=');
    // Comments are Macro threads: the Word file itself carries no comments.
    expect(files['word/comments.xml']).toBeUndefined();

    // Bob reloads and gets the merged document back from the server.
    const merged = await paragraphs(alice);
    await bob.reload();
    await expect
      .poll(() => bob.evaluate(() => window.docxFixture?.ready() ?? false), {
        timeout: 60_000,
      })
      .toBe(true);
    await expect.poll(() => paragraphs(bob)).toEqual(merged);
    if (SHOTS) await alice.screenshot({ path: `${SHOTS}/04-final.png` });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('viewers follow along read-only, and header edits reach them', async ({
  browser,
}) => {
  const documentId = crypto.randomUUID();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, viewer] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  try {
    await open(alice, documentId, ALICE, { fixture: 'complex-msa.docx' });
    await open(viewer, documentId, BOB, {
      readonly: '1',
      fixture: 'complex-msa.docx',
    });
    await expect(
      viewer.locator('.docx-body-flow [contenteditable="true"]')
    ).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Bold' })).toHaveCount(0);

    // A body edit in a document with a table, image and content control.
    await caretAtEnd(alice, 'Either party may terminate');
    await alice.keyboard.type(' Termination notices must be in writing.');
    await expect
      .poll(async () => (await paragraphs(viewer)).join('\n'))
      .toContain('Termination notices must be in writing.');

    // Header text lives in its own package part.
    const header = alice
      .locator('[data-hf-band="header"] [contenteditable="true"]')
      .first();
    await header.click();
    await alice.keyboard.press('End');
    await alice.keyboard.type(' (DRAFT)');
    await alice.locator('.docx-body-flow [data-anchor]').first().click();
    // Viewers read the print layout: every page repeats the header.
    await expect(viewer.locator('.docx-editor-host')).toContainText(
      'CONFIDENTIAL - Acme / Globex (DRAFT)'
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('edits made offline merge when the connection returns', async ({
  browser,
}) => {
  const documentId = crypto.randomUUID();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, bob] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  // Route Bob's sync socket through the test so the network can be cut.
  let offline = false;
  const sockets: Array<{ close: () => Promise<void> }> = [];
  await bob.routeWebSocket(/\/connect\?/, (socket) => {
    if (offline) {
      void socket.close();
      return;
    }
    socket.connectToServer();
    sockets.push(socket);
  });
  try {
    await open(alice, documentId, ALICE);
    await open(bob, documentId, BOB);
    offline = true;
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    await expect
      .poll(() => bob.evaluate(() => window.docxFixture?.status()))
      .not.toBe('connected');

    await caretAtEnd(bob, 'This Agreement shall remain');
    await bob.keyboard.type(' [written offline]');
    await caretAtEnd(alice, '"Representatives" means');
    await alice.keyboard.type(' [written online]');
    await expect
      .poll(async () => (await paragraphs(alice)).join('\n'))
      .toContain('[written online]');
    // Bob keeps working locally while disconnected.
    await expect
      .poll(async () => (await paragraphs(bob)).join('\n'))
      .toContain('[written offline]');

    offline = false;
    for (const page of [alice, bob]) {
      await expect
        .poll(async () => (await paragraphs(page)).join('\n'), {
          timeout: 60_000,
        })
        .toContain('[written offline]');
      await expect
        .poll(async () => (await paragraphs(page)).join('\n'), {
          timeout: 60_000,
        })
        .toContain('[written online]');
    }
    expect(await paragraphs(bob)).toEqual(await paragraphs(alice));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
