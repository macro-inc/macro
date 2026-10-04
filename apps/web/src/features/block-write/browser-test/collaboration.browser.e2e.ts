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

/** Echoes a collaborator's console errors into the test output. */
function logErrors(page: Page, name: string) {
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[${name}]`, message.text());
  });
  page.on('pageerror', (error) => console.log(`[${name}]`, error.message));
}

async function open(page: Page, documentId: string, user: string, extra = {}) {
  await page.goto(fixtureUrl(BASE, serverUrl, documentId, user, extra));
  await expect
    .poll(() => page.evaluate(() => window.docxFixture?.ready() ?? false), {
      timeout: 60_000,
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.docxFixture?.status()))
    .toBe('connected');
  // Pages are drawn by the engine into canvases.
  await expect(page.locator('[data-docx-page] canvas').first()).toBeVisible();
}

/** Paragraph texts as a collaborator's engine has them. */
const paragraphs = (page: Page) =>
  page.evaluate(() => window.docxFixture?.paragraphs() ?? []);

const joined = async (page: Page) => (await paragraphs(page)).join('\n');

/** Caret at the end of the paragraph starting with `prefix`, input focused. */
async function caretAtEnd(page: Page, prefix: string) {
  expect(
    await page.evaluate((p) => window.docxFixture?.place(p, 'end'), prefix)
  ).toBe(true);
}

async function selectParagraph(page: Page, prefix: string) {
  expect(
    await page.evaluate((p) => window.docxFixture?.place(p, 'all'), prefix)
  ).toBe(true);
}

const sharedBlock = (page: Page, prefix: string) =>
  page.evaluate((p) => window.docxFixture?.sharedBlock(p) ?? null, prefix);

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
  logErrors(alice, 'alice');
  logErrors(bob, 'bob');
  try {
    // Alice opens an unseen document: her client seeds it from the upload.
    await open(alice, documentId, ALICE);
    await open(bob, documentId, BOB);
    expect(await paragraphs(bob)).toEqual(await paragraphs(alice));
    if (SHOTS) await alice.screenshot({ path: `${SHOTS}/01-opened.png` });

    // Typing reaches Bob as it happens.
    await caretAtEnd(alice, 'This Agreement shall remain');
    await alice.keyboard.type(' Renewal requires mutual written consent.');
    await expect
      .poll(() => joined(bob))
      .toContain('Renewal requires mutual written consent.');

    // Concurrent edits to different paragraphs both survive.
    await caretAtEnd(alice, '"Representatives" means');
    await alice.keyboard.type(' [alice]');
    await caretAtEnd(bob, 'This Agreement shall be governed');
    await bob.keyboard.type(' [bob]');
    for (const page of [alice, bob]) {
      await expect.poll(() => joined(page)).toContain('[alice]');
      await expect.poll(() => joined(page)).toContain('[bob]');
    }

    // Concurrent typing in the same paragraph merges character by character.
    await caretAtEnd(alice, 'This Agreement shall remain');
    await caretAtEnd(bob, 'This Agreement shall remain');
    await Promise.all([
      alice.keyboard.type(' [one]'),
      bob.keyboard.type(' [two]'),
    ]);
    for (const page of [alice, bob]) {
      await expect.poll(() => joined(page)).toContain('[one]');
      await expect.poll(() => joined(page)).toContain('[two]');
    }
    await expect.poll(() => paragraphs(bob)).toEqual(await paragraphs(alice));

    // Enter splits a paragraph for everyone.
    const before = (await paragraphs(alice)).length;
    await caretAtEnd(bob, 'IN WITNESS WHEREOF');
    await bob.keyboard.press('Enter');
    await bob.keyboard.type('Signed by the parties below.');
    await expect
      .poll(async () => (await paragraphs(alice)).length)
      .toBe(before + 1);
    await expect
      .poll(() => joined(alice))
      .toContain('Signed by the parties below.');

    // Each sees the other's caret.
    await expect(alice.locator('[data-docx-peer]')).toHaveCount(1);
    await expect(alice.locator('[data-docx-peer]')).toContainText('Bob');
    if (SHOTS)
      await alice.screenshot({ path: `${SHOTS}/02-collaborating.png` });

    // Toolbar formatting is stored as text marks and reaches Bob.
    await selectParagraph(alice, 'This Agreement shall be governed');
    await alice.getByRole('button', { name: 'Bold' }).click();
    await expect
      .poll(async () =>
        (
          await sharedBlock(bob, 'This Agreement shall be governed')
        )?.attrs.every((a) => 'r:w:b' in a)
      )
      .toBe(true);

    // A list toggle adds numbering to the paragraph (and a definition).
    await caretAtEnd(alice, '"Confidential Information" means');
    await alice.getByRole('button', { name: 'Bulleted list' }).click();
    await expect
      .poll(
        async () =>
          (await sharedBlock(bob, '"Confidential Information" means'))?.props
      )
      .toContain('numPr');

    // Comments: select a paragraph, comment, and the thread appears beside
    // it for both collaborators, with the text highlighted.
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
      await expect(
        page.locator('[data-docx-comment-highlight]').first()
      ).toBeVisible();
    }
    // Edits to commented text keep the thread on it.
    await caretAtEnd(alice, 'Each party shall use');
    await alice.keyboard.type(' during the term');
    await expect(bob.locator('[data-docx-thread]')).toHaveCount(1);
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
    expect(documentXml).toContain('<w:numPr>');
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

test('undo and redo cover this person’s own edits', async ({ browser }) => {
  const documentId = crypto.randomUUID();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, bob] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  try {
    await open(alice, documentId, ALICE);
    await open(bob, documentId, BOB);

    await caretAtEnd(alice, 'This Agreement shall remain');
    await alice.keyboard.type(' [first]');
    await expect.poll(() => joined(bob)).toContain('[first]');
    // Bob's concurrent edit elsewhere is not Alice's to undo.
    await caretAtEnd(bob, '"Representatives" means');
    await bob.keyboard.type(' [bob]');
    await expect.poll(() => joined(alice)).toContain('[bob]');

    await alice.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => joined(alice)).not.toContain('[first]');
    await expect.poll(() => joined(bob)).not.toContain('[first]');
    expect(await joined(alice)).toContain('[bob]');
    await alice.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => joined(alice)).toContain('[first]');
    await expect.poll(() => joined(bob)).toContain('[first]');

    // The toolbar does the same.
    await alice.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => joined(bob)).not.toContain('[first]');
    await alice.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(() => joined(bob)).toContain('[first]');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('viewers follow along read-only', async ({ browser }) => {
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
    await expect(viewer.getByRole('button', { name: 'Bold' })).toHaveCount(0);
    await expect(viewer.locator('[data-docx-input]')).toHaveAttribute(
      'readonly',
      ''
    );

    // A body edit in a document with a table, image and content control.
    await caretAtEnd(alice, 'Either party may terminate');
    await alice.keyboard.type(' Termination notices must be in writing.');
    await expect
      .poll(() => joined(viewer))
      .toContain('Termination notices must be in writing.');
    // Typing does nothing for the viewer.
    await caretAtEnd(viewer, 'Either party may terminate');
    await viewer.keyboard.type('zzz');
    await expect.poll(() => joined(alice)).not.toContain('zzz');
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
  logErrors(alice, 'alice');
  logErrors(bob, 'bob');
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
    await caretAtEnd(alice, 'This Agreement shall remain');
    await alice.keyboard.type(' [written online]');
    await expect.poll(() => joined(alice)).toContain('[written online]');
    // Bob keeps working locally while disconnected.
    await expect.poll(() => joined(bob)).toContain('[written offline]');

    offline = false;
    for (const page of [alice, bob]) {
      await expect
        .poll(() => joined(page), { timeout: 60_000 })
        .toContain('[written offline]');
      await expect
        .poll(() => joined(page), { timeout: 60_000 })
        .toContain('[written online]');
    }
    expect(await paragraphs(bob)).toEqual(await paragraphs(alice));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
