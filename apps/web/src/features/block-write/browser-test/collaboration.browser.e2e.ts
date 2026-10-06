import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
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

test('random concurrent edits converge for everyone', async ({ browser }) => {
  const documentId = crypto.randomUUID();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, bob, carol] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  logErrors(alice, 'alice');
  logErrors(bob, 'bob');
  try {
    await open(alice, documentId, ALICE, { fixture: 'complex-msa.docx' });
    await open(bob, documentId, BOB, { fixture: 'complex-msa.docx' });
    /** Sixty edits at random places (typing, Enter, deleting, bold),
     * some in quick succession, from a seeded generator. */
    const randomEdits = (page: Page, seed: number) =>
      page.evaluate(async (seed) => {
        let state = seed;
        const rand = (n: number) => {
          state = (state * 1103515245 + 12345) % 2147483648;
          return state % n;
        };
        const editor = window.docxFixture?.editor();
        if (!editor) throw new Error('no editor');
        for (let i = 0; i < 60; i++) {
          const paras = (await editor.paragraphs()).filter((p) => p.text);
          const p = paras[rand(paras.length)];
          const offset = rand(p.text.length + 1);
          const at = { block: p.id, offset };
          const kind = rand(10);
          if (kind < 5)
            editor.run([
              { op: 'select', anchor: at, focus: at },
              { op: 'insertText', text: `<${seed}.${i}>` },
            ]);
          else if (kind < 6)
            editor.run([
              { op: 'select', anchor: at, focus: at },
              { op: 'insertParagraph' },
            ]);
          else if (kind < 8)
            editor.run([
              { op: 'select', anchor: at, focus: at },
              { op: 'delete', forward: rand(2) === 0 },
            ]);
          else {
            const end = Math.min(p.text.length, offset + 1 + rand(8));
            editor.run([
              { op: 'select', anchor: at, focus: { block: p.id, offset: end } },
              { op: 'toggleFormat', format: 'bold' },
            ]);
          }
          if (rand(3) === 0)
            await new Promise((resolve) => setTimeout(resolve, rand(40)));
        }
        await editor.idle();
      }, seed);
    await Promise.all([randomEdits(alice, 7), randomEdits(bob, 11)]);
    // Both end with the same paragraphs, every insertion kept once.
    await expect
      .poll(
        async () =>
          JSON.stringify(await paragraphs(alice)) ===
          JSON.stringify(await paragraphs(bob)),
        { timeout: 30_000 }
      )
      .toBe(true);
    const text = await joined(alice);
    for (const seed of [7, 11])
      for (const match of text.matchAll(new RegExp(`<${seed}\\.(\\d+)>`, 'g')))
        expect(text.split(match[0]).length - 1, match[0]).toBe(1);
    // Someone opening it now reads the same document.
    await open(carol, documentId, BOB, { fixture: 'complex-msa.docx' });
    expect(await paragraphs(carol)).toEqual(await paragraphs(alice));
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

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml';
const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A run of text. */
const run = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;

/**
 * A one-page DOCX built here rather than kept as a binary fixture, as a
 * data URL the fixture page can fetch: `body` paragraphs plus parts, each
 * with its relationship type (a full URI, or one under the office
 * relationships), content type suffix and XML.
 */
function docxDataUrl(
  body: string,
  parts: Record<string, { rel: string; type: string; xml: string }> = {}
) {
  const sect =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const entries = Object.entries(parts);
  const overrides = entries
    .map(
      ([name, p]) =>
        `<Override PartName="/word/${name}" ContentType="${WORD_CT}.${p.type}+xml"/>`
    )
    .join('');
  const rels = entries
    .map(
      ([name, p], i) =>
        `<Relationship Id="rIdP${i}" Type="${p.rel.includes('://') ? p.rel : `${REL}/${p.rel}`}" Target="${name}"/>`
    )
    .join('');
  const files: Record<string, string> = {
    '[Content_Types].xml': `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${WORD_CT}.document.main+xml"/>${overrides}</Types>`,
    '_rels/.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    'word/document.xml': `${XML_DECL}<w:document ${W_NS}><w:body>${body}${sect}</w:body></w:document>`,
  };
  for (const [name, p] of entries) files[`word/${name}`] = p.xml;
  const zip = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])
    )
  );
  return `data:${WORD_CT}.document;base64,${Buffer.from(zip).toString('base64')}`;
}

/** A short memo with two footnotes. */
function footnotedMemo() {
  const superscript = '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>';
  const ref = (id: number) =>
    `<w:r>${superscript}<w:footnoteReference w:id="${id}"/></w:r>`;
  const note = (id: number, t: string) =>
    `<w:footnote w:id="${id}"><w:p><w:r>${superscript}<w:footnoteRef/></w:r><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> ${t}</w:t></w:r></w:p></w:footnote>`;
  return docxDataUrl(
    [
      `<w:p>${run('The Seller shall deliver the Shares at Closing.')}${ref(1)}${run(' The Purchase Price is payable in cash.')}${ref(2)}</w:p>`,
      `<w:p>${run('Each party bears its own costs.')}</w:p>`,
    ].join(''),
    {
      'footnotes.xml': {
        rel: 'footnotes',
        type: 'footnotes',
        xml: `${XML_DECL}<w:footnotes ${W_NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${note(1, 'As defined in the Agreement.')}${note(2, 'In United States dollars.')}</w:footnotes>`,
      },
    }
  );
}

/** A memo carrying Word comments: one with a reply, one resolved. */
function commentedMemo() {
  const comment = (id: number, author: string, text: string, para: string) =>
    `<w:comment w:id="${id}" w:author="${author}" w:date="2026-09-30T10:00:00Z"><w:p w14:paraId="${para}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
  const ranged = (id: number, t: string) =>
    `<w:commentRangeStart w:id="${id}"/>${run(t)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
  return docxDataUrl(
    [
      `<w:p>${run('The ')}${ranged(0, 'Purchase Price')}<w:r><w:commentReference w:id="1"/></w:r>${run(' is payable at Closing.')}</w:p>`,
      `<w:p>${run('Each party bears ')}${ranged(2, 'its own costs')}${run('.')}</w:p>`,
    ].join(''),
    {
      'comments.xml': {
        rel: 'comments',
        type: 'comments',
        xml: `${XML_DECL}<w:comments ${W_NS}>${comment(0, 'Opposing Counsel', 'Should this include fees?', '0000000A')}${comment(1, 'Our Firm', 'No, fees are separate.', '0000000B')}${comment(2, 'Opposing Counsel', 'Agreed.', '0000000C')}</w:comments>`,
      },
      'commentsExtended.xml': {
        rel: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
        type: 'commentsExtended',
        xml: `${XML_DECL}<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="0000000A" w15:done="0"/><w15:commentEx w15:paraId="0000000B" w15:paraIdParent="0000000A" w15:done="0"/><w15:commentEx w15:paraId="0000000C" w15:done="1"/></w15:commentsEx>`,
      },
    }
  );
}

test('comments in the file show beside their text', async ({ browser }) => {
  const documentId = crypto.randomUUID();
  const context = await browser.newContext();
  const page = await context.newPage();
  logErrors(page, 'alice');
  try {
    await open(page, documentId, ALICE, { src: commentedMemo() });
    // One card per comment, its reply inside it.
    const first = page.locator('[data-docx-word-comment="0"]');
    await expect(first).toContainText('Opposing Counsel');
    await expect(first).toContainText('Should this include fees?');
    await expect(first).toContainText('No, fees are separate.');
    await expect(page.locator('[data-docx-word-comment="1"]')).toHaveCount(0);
    await expect(page.locator('[data-docx-word-comment="2"]')).toContainText(
      'Resolved'
    );
    // The commented text is highlighted.
    await expect(
      page.locator('[data-docx-comment-highlight="word:0"]').first()
    ).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-word-comments.png` });
    // The comments stay in the downloaded file.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download .docx' }).click(),
    ]);
    const files = unzipSync(
      new Uint8Array(await readFile((await download.path())!))
    );
    expect(strFromU8(files['word/comments.xml'])).toContain(
      'Should this include fees?'
    );
  } finally {
    await context.close();
  }
});

test('footnotes are edited where they are and shared', async ({ browser }) => {
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
  const src = footnotedMemo();
  try {
    await open(alice, documentId, ALICE, { src });
    await open(bob, documentId, BOB, { src });

    // One click in the first footnote's text puts the caret there.
    const sheet = alice.locator('[data-docx-page="0"]');
    await sheet.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    let box = (await sheet.boundingBox())!;
    const page = (await alice.evaluate(
      () => window.docxFixture?.editor()?.pages()[0]
    ))!;
    expect(page.notes).toBeTruthy();
    const scale = box.width / page.width;
    const notes = page.notes!;
    // The first note's line is the area's top line.
    await alice.mouse.click(
      box.x + box.width / 2,
      box.y + (notes.top + 6) * scale
    );
    await expect.poll(() => story(alice)).toBe('footnote');
    await alice.keyboard.press('End');
    await alice.keyboard.type(' (as amended)');
    // The notes part reaches Bob through the sync service.
    await expect
      .poll(() =>
        bob.evaluate(() => window.docxFixture?.sharedPart('footnotes.xml'))
      )
      .toContain('As defined in the Agreement. (as amended)');
    if (SHOTS) await alice.screenshot({ path: `${SHOTS}/05b-footnote.png` });

    // A click on the body goes back to it.
    await sheet.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    box = (await sheet.boundingBox())!;
    await alice.mouse.click(box.x + box.width / 2, box.y + 76 * scale);
    await expect.poll(() => story(alice)).toBe('body');
    await caretAtEnd(alice, 'Each party bears');
    await alice.keyboard.type(' [body]');
    await expect.poll(() => joined(bob)).toContain('[body]');

    // Ctrl+Alt+F adds a footnote at the caret and moves into it.
    await alice.keyboard.press('Control+Alt+KeyF');
    await expect.poll(() => story(alice)).toBe('footnote');
    await alice.keyboard.type('Including counsel fees.');
    await expect
      .poll(() =>
        bob.evaluate(() => window.docxFixture?.sharedPart('footnotes.xml'))
      )
      .toContain('Including counsel fees.');
    if (SHOTS)
      await alice.screenshot({ path: `${SHOTS}/05c-new-footnote.png` });
    await alice.keyboard.press('Escape');
    await expect.poll(() => story(alice)).toBe('body');

    // Bob's download carries the edited note and keeps the separators.
    const [download] = await Promise.all([
      bob.waitForEvent('download'),
      bob.getByRole('button', { name: 'Download .docx' }).click(),
    ]);
    const files = unzipSync(
      new Uint8Array(await readFile((await download.path())!))
    );
    const saved = strFromU8(files['word/footnotes.xml']);
    expect(saved).toContain('(as amended)');
    expect(saved).toContain('w:type="separator"');
    expect(saved).toContain('In United States dollars.');
    expect(saved).toContain('Including counsel fees.');
    expect(
      strFromU8(files['word/document.xml']).match(/footnoteReference/g)
    ).toHaveLength(3);
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

test('toolbar formatting and table commands reach collaborators', async ({
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
  const rowCount = (page: Page) =>
    page.evaluate(() => window.docxFixture?.sharedCount('tr') ?? 0);
  const menu = async (page: Page, name: string, item: string) => {
    await page.locator(`[data-docx-menu="${name}"]`).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };
  try {
    await open(alice, documentId, ALICE, { fixture: 'complex-msa.docx' });
    await open(bob, documentId, BOB, { fixture: 'complex-msa.docx' });

    // Highlight, color and line spacing on a paragraph.
    await selectParagraph(alice, 'Kickoff');
    await menu(alice, 'highlight', 'Yellow');
    await menu(alice, 'color', 'Red');
    await expect
      .poll(async () =>
        JSON.stringify((await sharedBlock(bob, 'Kickoff'))?.attrs)
      )
      .toContain('w:highlight w:val=\\"yellow\\"');
    await expect
      .poll(async () =>
        JSON.stringify((await sharedBlock(bob, 'Kickoff'))?.attrs)
      )
      .toContain('FF0000');
    // The document keeps the caret: typing replaces the selection.
    await expect(alice.locator('[data-docx-input]')).toBeFocused();
    await expect
      .poll(() =>
        alice.evaluate(
          () => window.docxFixture?.editor()?.state()?.format.highlight
        )
      )
      .toBe('yellow');

    // Rows added from the table menu, which shows inside tables only.
    const before = await rowCount(bob);
    await expect(alice.locator('[data-docx-menu="table"]')).toBeVisible();
    await menu(alice, 'table', 'Insert row below');
    await expect.poll(() => rowCount(bob)).toBe(before + 1);
    await caretAtEnd(alice, 'Provider shall perform');
    await expect(alice.locator('[data-docx-menu="table"]')).toHaveCount(0);
    await menu(alice, 'line-spacing', '2.0');
    await expect
      .poll(
        async () => (await sharedBlock(bob, 'Provider shall perform'))?.props
      )
      .toContain('w:line="480"');
    if (SHOTS) await alice.screenshot({ path: `${SHOTS}/09-toolbar.png` });
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

test('comment cards leave a narrow pane a legible page', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 480, height: 800 },
  });
  const page = await context.newPage();
  try {
    await open(page, crypto.randomUUID(), ALICE);
    await selectParagraph(page, 'Each party shall use');
    await page.getByRole('button', { name: 'Comment on selection' }).click();
    await page.getByRole('textbox', { name: 'Comment text' }).fill('Why?');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.locator('[data-docx-thread]')).toContainText('Why?');
    const layout = () =>
      page.evaluate(() => {
        const sheet = document.querySelector('[data-docx-page]')!;
        const scroller = document.querySelector('[data-docx-scroller]')!;
        return {
          page: sheet.getBoundingClientRect().width,
          scrolls: scroller.scrollWidth > scroller.clientWidth,
        };
      });
    // The page keeps a legible width and the pane scrolls sideways to the card.
    await expect
      .poll(async () => (await layout()).page)
      .toBeGreaterThanOrEqual(479);
    expect((await layout()).scrolls).toBe(true);
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
