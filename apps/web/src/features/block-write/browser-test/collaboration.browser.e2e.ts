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

/** Start tags of the elements wrapping a shared paragraph's text. */
async function wrappers(page: Page, prefix: string) {
  const attrs = (await sharedBlock(page, prefix))?.attrs ?? [];
  return attrs
    .flatMap((a) =>
      a.wrap ? (JSON.parse(a.wrap) as [string, string][]).map(([o]) => o) : []
    )
    .join(' ');
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

test('headers and footers are edited in place and shared', async ({
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
  const story = (page: Page) =>
    page.evaluate(() => window.docxFixture?.editor()?.state()?.story.kind);
  try {
    await open(alice, documentId, ALICE, { fixture: 'complex-msa.docx' });
    await open(bob, documentId, BOB, { fixture: 'complex-msa.docx' });

    // Double-click the header of the first page.
    const sheet = alice.locator('[data-docx-page="0"]');
    const box = (await sheet.boundingBox())!;
    const page = (await alice.evaluate(
      () => window.docxFixture?.editor()?.pages()[0]
    ))!;
    const scale = box.width / page.width;
    const headerY = ((page.header?.top ?? 0) + (page.header?.bottom ?? 0)) / 2;
    await alice.mouse.dblclick(box.x + box.width / 2, box.y + headerY * scale);
    await expect.poll(() => story(alice)).toBe('header');
    await expect(alice.locator('[data-docx-story-label]')).toContainText(
      'Header'
    );
    await alice.keyboard.press('End');
    await alice.keyboard.type(' (Draft 2)');
    // The header part reaches Bob through the sync service.
    await expect
      .poll(() =>
        bob.evaluate(() => window.docxFixture?.sharedPart('header1.xml'))
      )
      .toContain('(Draft 2)');
    if (SHOTS) await alice.screenshot({ path: `${SHOTS}/05-header.png` });

    // Escape returns to the body, where typing goes to the body again.
    await alice.keyboard.press('Escape');
    await expect.poll(() => story(alice)).toBe('body');
    await caretAtEnd(alice, 'Either party may terminate');
    await alice.keyboard.type(' [body]');
    await expect.poll(() => joined(bob)).toContain('[body]');

    // Bob's download carries the new header.
    const [download] = await Promise.all([
      bob.waitForEvent('download'),
      bob.getByRole('button', { name: 'Download .docx' }).click(),
    ]);
    const files = unzipSync(
      new Uint8Array(await readFile((await download.path())!))
    );
    expect(strFromU8(files['word/header1.xml'])).toContain('(Draft 2)');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('tracked changes are recorded per author and resolved for everyone', async ({
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
  const tracking = (page: Page) =>
    page.evaluate(() => window.docxFixture?.editor()?.state()?.format.tracking);
  try {
    await open(alice, documentId, ALICE);
    await open(bob, documentId, BOB);
    const original = await paragraphs(alice);

    // Alice turns tracking on for the document; Bob's editor follows.
    await alice.getByRole('button', { name: 'Track changes' }).click();
    await expect.poll(() => tracking(alice)).toBe(true);
    await expect
      .poll(() =>
        bob.evaluate(() => window.docxFixture?.sharedPart('settings.xml'))
      )
      .toContain('trackRevisions');
    // Bob's next edit refreshes his formatting state.
    await caretAtEnd(bob, 'This Agreement shall remain');
    await expect.poll(() => tracking(bob)).toBe(true);

    // Bob's typing is his insertion, his deletion is marked, not removed.
    await bob.keyboard.type(' Renewal requires mutual consent.');
    await caretAtEnd(bob, 'This Agreement shall be governed');
    for (let i = 0; i < 9; i++) await bob.keyboard.press('Backspace');
    await expect
      .poll(() => wrappers(alice, 'This Agreement shall remain'))
      .toContain('w:author="Bob"');
    await expect
      .poll(() => wrappers(alice, 'This Agreement shall be governed'))
      .toContain('<w:del ');
    // The deleted text is still there, struck through.
    expect(await joined(alice)).toContain('principles.');
    if (SHOTS) await alice.screenshot({ path: `${SHOTS}/06-tracked.png` });

    // Alice rejects everything: both see the original text again.
    await alice.getByRole('button', { name: 'Reject all changes' }).click();
    for (const page of [alice, bob])
      await expect.poll(() => paragraphs(page)).toEqual(original);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('find and replace, shared with everyone', async ({ browser }) => {
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
  const occurrences = async (page: Page, word: RegExp) =>
    (await joined(page)).match(word)?.length ?? 0;
  try {
    await open(alice, documentId, ALICE);
    await open(bob, documentId, BOB);
    const count = await occurrences(alice, /agreement/gi);
    expect(count).toBeGreaterThan(2);

    // Mod+F in the document opens the find bar; matches are counted and
    // highlighted on the pages.
    await caretAtEnd(alice, 'This Agreement shall remain');
    await alice.keyboard.press('Control+f');
    const field = alice.locator('[data-docx-find-query]');
    await expect(field).toBeFocused();
    await field.fill('agreement');
    const status = alice.locator('[data-docx-find-status]');
    await expect(status).toHaveText(new RegExp(`^\\d+ of ${count}$`));
    await expect(alice.locator('.docx-find-current')).toHaveCount(1);
    await expect(alice.locator('[data-docx-find-match]')).not.toHaveCount(0);
    // Enter moves on (wrapping), selecting the match in the document.
    const first = await status.textContent();
    await field.press('Enter');
    await expect(status).not.toHaveText(first ?? '');
    const selected = () =>
      alice.evaluate(() => window.docxFixture?.editor()?.selectedText());
    await expect.poll(selected).toMatch(/^agreement$/i);
    if (SHOTS) await alice.screenshot({ path: `${SHOTS}/08-find.png` });

    // Replace the current match, then the rest; Bob sees both.
    await alice.locator('[data-docx-find-replace-toggle]').click();
    await alice.locator('[data-docx-find-replacement]').fill('Contract');
    await alice.locator('[data-docx-replace]').click();
    await expect(status).toHaveText(new RegExp(`^\\d+ of ${count - 1}$`));
    await expect.poll(() => occurrences(bob, /Contract/g)).toBe(1);
    await alice.locator('[data-docx-replace-all]').click();
    await expect(status).toHaveText(`Replaced ${count - 1}`);
    for (const page of [alice, bob]) {
      await expect.poll(() => occurrences(page, /agreement/gi)).toBe(0);
      await expect.poll(() => occurrences(page, /Contract/g)).toBe(count);
    }

    // Escape closes the bar; one undo takes back the whole replace all.
    await alice.locator('[data-docx-find-replacement]').press('Escape');
    await expect(alice.locator('[data-docx-find]')).toHaveCount(0);
    await expect(alice.locator('[data-docx-input]')).toBeFocused();
    await alice.keyboard.press('Control+z');
    for (const page of [alice, bob])
      await expect.poll(() => occurrences(page, /agreement/gi)).toBe(count - 1);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('copy and paste keep formatting, from here and from other apps', async ({
  browser,
}) => {
  const documentId = crypto.randomUUID();
  const contexts = await Promise.all([
    browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }),
    browser.newContext(),
  ]);
  const [alice, bob] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  logErrors(alice, 'alice');
  logErrors(bob, 'bob');
  try {
    await open(alice, documentId, ALICE);
    await open(bob, documentId, BOB);
    // The first paragraph has a bold defined term ("Agreement").
    await selectParagraph(alice, 'This Mutual Non-Disclosure');
    await alice.keyboard.press('ControlOrMeta+c');
    await expect
      .poll(() =>
        alice.evaluate(async () => {
          const [item] = await navigator.clipboard.read();
          return item?.types ?? [];
        })
      )
      .toContain('text/html');
    await caretAtEnd(alice, 'IN WITNESS WHEREOF');
    await alice.keyboard.press('Enter');
    await alice.keyboard.press('ControlOrMeta+v');
    await expect
      .poll(async () =>
        (await paragraphs(bob)).filter((p) =>
          p.startsWith('This Mutual Non-Disclosure')
        )
      )
      .toHaveLength(2);
    const copies = await bob.evaluate(() => {
      const fixture = window.docxFixture;
      return fixture?.sharedBlock('This Mutual Non-Disclosure');
    });
    expect(JSON.stringify(copies?.attrs)).toContain('r:w:b');

    // HTML from another application keeps bold text and becomes a list.
    await caretAtEnd(alice, 'IN WITNESS WHEREOF');
    await alice.keyboard.press('Enter');
    await alice.evaluate(() => {
      const data = new DataTransfer();
      data.setData(
        'text/html',
        '<b style="font-weight:normal" id="docs-internal-guid-1"><p><span style="font-weight:700">Notices.</span><span> All notices</span></p><ul><li><p>by email</p></li><li><p>by courier</p></li></ul></b>'
      );
      data.setData('text/plain', 'Notices. All notices\nby email\nby courier');
      document.querySelector('[data-docx-input]')?.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await expect
      .poll(async () => (await sharedBlock(bob, 'by courier'))?.props ?? '')
      .toContain('numPr');
    expect(
      JSON.stringify((await sharedBlock(bob, 'Notices.'))?.attrs ?? [])
    ).toContain('r:w:b');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('on a touch screen, a swipe scrolls and taps place the caret', async ({
  browser,
}) => {
  const documentId = crypto.randomUUID();
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 420, height: 760 },
  });
  const page = await context.newPage();
  logErrors(page, 'touch');
  const cdp = await context.newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    x: number,
    y: number
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  const selection = () =>
    page.evaluate(() => window.docxFixture?.editor()?.state()?.selection);
  const focused = () =>
    page.evaluate(() =>
      document.activeElement?.hasAttribute('data-docx-input')
    );
  try {
    await open(page, documentId, ALICE);
    const scroller = page.locator('[data-docx-scroller]');
    const sheet = await page.locator('[data-docx-page="0"]').boundingBox();
    if (!sheet) throw new Error('no page');
    // A point on the first body line.
    const caret = await page.evaluate(async () => {
      const editor = window.docxFixture?.editor();
      const first = (await editor?.paragraphs())?.find((p) => p.text.trim());
      return first
        ? editor?.caretAt({ block: first.id, offset: 2 })
        : undefined;
    });
    if (!caret) throw new Error('no caret');
    const scale =
      sheet.width /
      (await page.evaluate(
        () => window.docxFixture?.editor()?.pages()[0]?.width ?? 1
      ));
    const x = sheet.x + caret.x * scale;
    const y = sheet.y + (caret.y + caret.height / 2) * scale;

    // A swipe scrolls the pages and leaves the keyboard closed.
    await touch('touchStart', 200, 600);
    for (let i = 1; i <= 8; i++) await touch('touchMove', 200, 600 - i * 40);
    await touch('touchEnd', 0, 0);
    await expect
      .poll(() => scroller.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(30);
    expect(await focused()).toBe(false);
    await scroller.evaluate((e) => {
      e.scrollTop = 0;
    });

    // A tap places the caret there and focuses the text input.
    await page.touchscreen.tap(x, y);
    await expect.poll(focused).toBe(true);
    await expect
      .poll(async () => {
        const s = await selection();
        return s && s.anchor.offset === s.focus.offset ? s.focus.offset : -1;
      })
      .toBeGreaterThanOrEqual(0);

    // A double tap selects a word (after a pause: no double tap with the
    // tap before).
    await page.waitForTimeout(400);
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect
      .poll(async () => {
        const s = await selection();
        return s ? s.focus.offset - s.anchor.offset : 0;
      })
      .toBeGreaterThan(1);

    // A long press selects a word too.
    await page.evaluate(() =>
      window.docxFixture
        ?.editor()
        ?.run([{ op: 'move', unit: 'document', forward: false, extend: false }])
    );
    await touch('touchStart', x, y);
    await page.waitForTimeout(800);
    await touch('touchEnd', 0, 0);
    await expect
      .poll(async () => {
        const s = await selection();
        return s ? s.focus.offset - s.anchor.offset : 0;
      })
      .toBeGreaterThan(1);
  } finally {
    await context.close();
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
