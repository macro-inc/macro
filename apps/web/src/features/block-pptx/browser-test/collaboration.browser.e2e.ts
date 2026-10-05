import { expect, type Page, test } from '@playwright/test';
import { collaboratorUrl, startSyncServer } from './sync-server';

const DECK = 'generated/kitchen-sink-financial.pptx';
// Slide 1 of the kitchen-sink deck (ids and positions in points).
const TITLE = { shape: 2, x: 72, y: 168, w: 816, h: 116 };
const SUBTITLE = { shape: 3, x: 144, y: 306, w: 672, h: 138 };

let sync: Awaited<ReturnType<typeof startSyncServer>>;

test.beforeAll(async () => {
  sync = await startSyncServer();
});

test.afterAll(async () => {
  await sync?.server.dispose();
});

let documentCount = 0;
const newDocument = () => `deck-${Date.now().toString(36)}-${documentCount++}`;

/** Opens `user`'s editor on `documentId` (each user on their own origin). */
async function join(page: Page, documentId: string, user: string) {
  const origin = `http://${user}.localhost:3018`;
  await page.goto(
    collaboratorUrl(
      origin,
      sync.url,
      documentId,
      `macro|${user}@example.com`,
      DECK
    )
  );
  await expect(page.getByTestId('pptx-editor')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('fixture-collab')).toHaveText('connected');
  await expect(page.getByTestId('pptx-thumbnail')).toHaveCount(8);
}

async function people(
  browser: import('@playwright/test').Browser,
  names: string[]
) {
  const documentId = newDocument();
  const pages: Page[] = [];
  for (const name of names) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await join(page, documentId, name);
    pages.push(page);
  }
  return { documentId, pages };
}

function shapeText(page: Page, slideIndex: number, shape: number) {
  return page.evaluate(
    async ({ slideIndex, shape }) => {
      const engine = window.pptxFixture.engine();
      if (!engine) return undefined;
      const deck = await engine.outline();
      const found = deck.slides[slideIndex]?.shapes.find((s) => s.id === shape);
      return found?.paragraphs?.map((p) => p.text).join('\n');
    },
    { slideIndex, shape }
  );
}

function sharedEntries(page: Page) {
  return page.evaluate(() => window.pptxFixture.collab?.entries());
}

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const scale = box.width / 960;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function typeInto(page: Page, shape: typeof TITLE, text: string) {
  const at = await screen(page, shape.x + shape.w / 2, shape.y + shape.h / 2);
  await page.mouse.dblclick(at.x, at.y);
  // The caret is a zero-width line, which Playwright never calls visible.
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test('people see each other’s edits and selections live', async ({
  browser,
}) => {
  const {
    pages: [alice, bob],
  } = await people(browser, ['alice', 'bob']);

  await typeInto(alice, TITLE, ' (shared)');
  await expect
    .poll(() => shapeText(bob, 0, TITLE.shape))
    .toBe('Q3 FY2024 Earnings Review (shared)');
  await expect(bob.getByTestId('pptx-thumbnail').first()).toHaveAttribute(
    'aria-label',
    'Slide 1: Q3 FY2024 Earnings Review (shared)'
  );

  // Alice's selection shows on Bob's slide with her name.
  const at = await screen(
    alice,
    SUBTITLE.x + SUBTITLE.w / 2,
    SUBTITLE.y + SUBTITLE.h / 2
  );
  await alice.mouse.click(at.x, at.y);
  await expect(bob.getByTestId('pptx-peer-selection')).toHaveAttribute(
    'data-peer',
    'Alice'
  );
  await expect(bob.getByTestId('pptx-collaborator')).toHaveText('A');
  await expect(alice.getByTestId('pptx-collaborator')).toHaveText('B');
});

test('concurrent edits to one slide merge', async ({ browser }) => {
  const {
    pages: [alice, bob],
  } = await people(browser, ['alice', 'bob']);
  await Promise.all([
    typeInto(alice, TITLE, ' by Alice'),
    typeInto(bob, SUBTITLE, ' by Bob'),
  ]);
  for (const page of [alice, bob]) {
    await expect
      .poll(() => shapeText(page, 0, TITLE.shape))
      .toBe('Q3 FY2024 Earnings Review by Alice');
    await expect
      .poll(async () =>
        (await shapeText(page, 0, SUBTITLE.shape))?.endsWith(' by Bob')
      )
      .toBe(true);
  }
  await expect
    .poll(
      async () =>
        JSON.stringify(await sharedEntries(alice)) ===
        JSON.stringify(await sharedEntries(bob))
    )
    .toBe(true);
});

test('slides added at the same time both survive', async ({ browser }) => {
  const {
    pages: [alice, bob],
  } = await people(browser, ['alice', 'bob']);
  await Promise.all([
    alice.getByTestId('pptx-new-slide').click(),
    bob.getByTestId('pptx-new-slide').click(),
  ]);
  await expect(alice.getByTestId('pptx-thumbnail')).toHaveCount(10);
  await expect(bob.getByTestId('pptx-thumbnail')).toHaveCount(10);
});

test('undo takes back only your own change', async ({ browser }) => {
  const {
    pages: [alice, bob],
  } = await people(browser, ['alice', 'bob']);
  await typeInto(alice, TITLE, '!');
  await typeInto(bob, SUBTITLE, ' (Bob)');
  await expect
    .poll(async () =>
      (await shapeText(alice, 0, SUBTITLE.shape))?.endsWith(' (Bob)')
    )
    .toBe(true);
  await alice.getByTestId('pptx-stage').click({ position: { x: 5, y: 5 } });
  await alice.keyboard.press('ControlOrMeta+z');
  for (const page of [alice, bob]) {
    await expect
      .poll(() => shapeText(page, 0, TITLE.shape))
      .toBe('Q3 FY2024 Earnings Review');
    await expect
      .poll(async () =>
        (await shapeText(page, 0, SUBTITLE.shape))?.endsWith(' (Bob)')
      )
      .toBe(true);
  }
});

test('someone joining later opens the shared edits', async ({ browser }) => {
  const {
    documentId,
    pages: [alice],
  } = await people(browser, ['alice']);
  await typeInto(alice, TITLE, ' v2');
  await expect
    .poll(() => shapeText(alice, 0, TITLE.shape))
    .toBe('Q3 FY2024 Earnings Review v2');
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const carol = await context.newPage();
  await join(carol, documentId, 'carol');
  await expect
    .poll(() => shapeText(carol, 0, TITLE.shape))
    .toBe('Q3 FY2024 Earnings Review v2');
});
