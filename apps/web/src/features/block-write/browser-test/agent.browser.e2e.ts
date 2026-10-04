import type { DocxAgentRequest } from '@macro-inc/collaboration/docx/agent';
import { expect, type Page, test } from '@playwright/test';
import type { Miniflare } from 'miniflare';
import { fixtureUrl, startSyncServer } from './sync-server';

let server: Miniflare;
let serverUrl: string;
// The sync Worker allows localhost origins (ports 3000-3999).
const BASE = 'http://localhost:3018';
const ALICE = 'macro|alice@example.com';
const AGENT = 'macro|ai@macro.com';

test.beforeAll(async () => {
  ({ server, url: serverUrl } = await startSyncServer());
});
test.afterAll(async () => {
  await server?.dispose();
});

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
}

const paragraphs = async (page: Page) =>
  (await page.evaluate(() => window.docxFixture?.paragraphs() ?? [])).join(
    '\n'
  );

/** What the AI tools do, run the way the editing worker runs it. */
const agent = (page: Page, request: DocxAgentRequest) =>
  page.evaluate(
    async (request) => (await window.docxFixture!.agent(request)).content,
    request
  );

/** The id ReadWordDocument shows for the paragraph whose text starts so. */
function paragraphId(description: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`paragraph (\\w{32})[^\\n]*\\n\\s+${escaped}`).exec(
    description
  );
  if (!match) throw new Error(`no paragraph starting "${text}"`);
  return match[1];
}

test('AI tool edits reach an open editor live and survive a reopen', async ({
  browser,
}) => {
  const documentId = crypto.randomUUID();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, worker] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  for (const page of [alice, worker])
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('[page]', message.text());
    });
  try {
    // Alice opens the upload, which seeds its live copy.
    await open(alice, documentId, ALICE);
    await open(worker, documentId, AGENT);

    const read = await agent(worker, { action: 'read' });
    expect(read).toContain('Word document with 17 blocks.');
    const term = paragraphId(read, 'This Agreement shall remain');
    const heading = paragraphId(read, '3. Term');
    const definition = paragraphId(read, '"Confidential Information" means');

    const edited = await agent(worker, {
      action: 'edit',
      operations: [
        {
          type: 'replaceText',
          paragraph: term,
          find: 'two (2) years',
          replace: 'three (3) years',
        },
        {
          type: 'insertParagraph',
          after: heading,
          text: 'This section sets out how long the Agreement lasts.',
        },
        {
          type: 'formatText',
          paragraph: definition,
          find: 'Confidential Information',
          bold: true,
        },
        { type: 'setStyle', paragraph: term, style: 'Quote' },
      ],
    });
    expect(edited).toContain('Applied 4 operations.');

    // Alice's editor patches the changes in without a reload.
    await expect
      .poll(() => paragraphs(alice))
      .toContain('for a period of three (3) years');
    const text = await paragraphs(alice);
    expect(text).toMatch(
      /3\. Term\nThis section sets out how long the Agreement lasts\.\nThis Agreement shall remain/
    );
    const bold = alice
      .locator('.docx-body-flow [data-anchor]')
      .filter({ hasText: '"Confidential Information" means' })
      .locator('span, b, strong')
      .filter({ hasText: /^Confidential Information$/ })
      .first();
    await expect(bold).toHaveCSS('font-weight', '700');

    // People keep editing alongside it.
    await alice
      .locator('.docx-body-flow [data-anchor][contenteditable="true"]')
      .filter({ hasText: 'This section sets out' })
      .first()
      .click();
    await alice.keyboard.press('End');
    await alice.keyboard.type(' [alice]');
    await expect
      .poll(() => paragraphs(worker))
      .toContain('how long the Agreement lasts. [alice]');

    // A request the document cannot satisfy changes nothing.
    await expect(
      agent(worker, {
        action: 'edit',
        operations: [{ type: 'delete', id: 'not-a-paragraph' }],
      })
    ).rejects.toThrow(/No paragraph or block has id not-a-paragraph/);

    // The edited document opens cleanly from its live copy.
    await alice.reload();
    await open(alice, documentId, ALICE);
    const reopened = await paragraphs(alice);
    expect(reopened).toContain('for a period of three (3) years');
    expect(reopened).toContain('how long the Agreement lasts. [alice]');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('AI tool edits inside table cells', async ({ browser }) => {
  const documentId = crypto.randomUUID();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, worker] = await Promise.all(
    contexts.map((context) => context.newPage())
  );
  try {
    await open(alice, documentId, ALICE, { fixture: 'complex-msa.docx' });
    await open(worker, documentId, AGENT, { fixture: 'complex-msa.docx' });
    const read = await agent(worker, { action: 'read' });
    const cell = /row 2, cell 1:\n\s+paragraph (\w{32})/.exec(read)?.[1];
    expect(cell).toBeDefined();
    await agent(worker, {
      action: 'edit',
      operations: [
        { type: 'setText', paragraph: cell!, text: 'Discovery phase' },
        { type: 'insertParagraph', after: cell!, text: 'Weeks 1-2' },
      ],
    });
    await expect
      .poll(() => paragraphs(alice))
      .toMatch(/Discovery phase\nWeeks 1-2/);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
