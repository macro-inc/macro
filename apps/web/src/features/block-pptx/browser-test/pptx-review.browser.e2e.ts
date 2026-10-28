import type { EditOp } from '@core/pptx-engine/types';
import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';
/** Its fourth slide has two comments in the pre-2021 format. */
const SLIDE_FEATURES = 'generated/slide-features.pptx';

async function open(page: Page, deck = KITCHEN_SINK) {
  await page.goto(`/?deck=${encodeURIComponent(deck)}&autosave=0`);
  await expect(page.getByTestId('pptx-editor')).toBeVisible();
  await expect(page.getByTestId('pptx-thumbnail').first()).toBeVisible();
}

function outline(page: Page) {
  return page.evaluate(async () => {
    const engine = window.pptxFixture.engine();
    if (!engine) throw new Error('No presentation is open.');
    return engine.outline();
  });
}

const comments = async (page: Page, index: number) =>
  (await outline(page)).slides[index].comments ?? [];

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const deck = await outline(page);
  const scale = box.width / deck.width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

/** Text of the slide's text boxes holding `needle`. */
async function textWith(page: Page, index: number, needle: string) {
  const deck = await outline(page);
  return deck.slides[index].shapes
    .flatMap((s) => s.paragraphs ?? [])
    .map((p) => p.text)
    .filter((t) => t.includes(needle));
}

/** Adds text boxes the way another client would, then waits for the reload. */
async function seed(page: Page, ops: EditOp[]) {
  await page.evaluate(
    (json) => window.pptxFixture.externalEdit(JSON.parse(json) as EditOp[]),
    JSON.stringify(ops)
  );
  await expect
    .poll(() => page.evaluate(() => window.pptxFixture.notices().length))
    .toBeGreaterThan(0);
}

test('adds, replies to, resolves, and deletes comments', async ({ page }) => {
  await open(page);
  const deck = await outline(page);
  const title = deck.slides[0].shapes.find((s) =>
    s.placeholder?.toLowerCase().includes('title')
  );
  if (!title) throw new Error('The first slide has no title.');
  // Select the title, then Review ▸ New Comment.
  const at = await screen(page, title.x + 10, title.y + title.h / 2);
  await page.mouse.click(at.x, at.y);
  await page.getByTestId('pptx-tab-review').click();
  await page.getByTestId('pptx-review-new-comment').click();
  const pane = page.getByTestId('pptx-comments-pane');
  await expect(pane).toBeVisible();
  await expect(page.getByTestId('pptx-comment-draft')).toBeFocused();
  // A marker shows where the comment will go while it is written.
  await expect(page.getByTestId('pptx-comment-marker-draft')).toBeVisible();
  await page.getByTestId('pptx-comment-draft').fill('Is this the final title?');
  await page.getByTestId('pptx-comment-post').click();

  const thread = pane.getByTestId('pptx-comment-thread');
  await expect(thread).toHaveCount(1);
  await expect(page.getByTestId('pptx-comment-marker-draft')).toHaveCount(0);
  await expect(thread.getByTestId('pptx-comment-author').first()).toHaveText(
    'Alex Morgan'
  );
  await expect(thread.getByTestId('pptx-comment-time').first()).toHaveText(
    'A few seconds ago'
  );
  await expect(thread).toHaveAttribute('aria-current', 'true');
  let list = await comments(page, 0);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    author: 'Alex Morgan',
    initials: 'AM',
    text: 'Is this the final title?',
    shape: title.id,
    resolved: false,
    legacy: false,
  });
  // A marker sits by the shape, and the thumbnail shows the slide has comments.
  const marker = page.getByTestId('pptx-comment-marker');
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByTestId('pptx-thumbnail-comments').first()
  ).toBeVisible();

  // Reply.
  await thread.getByTestId('pptx-comment-reply').fill('Yes, approved.');
  await thread.getByTestId('pptx-comment-reply-post').click();
  await expect(thread.getByTestId('pptx-comment-reply-item')).toHaveCount(1);
  await expect
    .poll(async () => (await comments(page, 0))[0].replies?.[0]?.text)
    .toBe('Yes, approved.');

  // Edit the first comment from its "…" menu.
  await thread.getByTestId('pptx-comment-menu').first().click();
  await page.getByTestId('pptx-comment-edit').click();
  await page.getByTestId('pptx-comment-edit-input').fill('Is this final?');
  await page.getByTestId('pptx-comment-save').click();
  await expect(thread.getByTestId('pptx-comment-text').first()).toHaveText(
    'Is this final?'
  );

  // Resolve, then reopen.
  await thread.getByTestId('pptx-comment-menu').first().click();
  await page.getByTestId('pptx-comment-resolve').click();
  await expect(thread).toHaveAttribute('data-resolved', 'true');
  await expect
    .poll(async () => (await comments(page, 0))[0].resolved)
    .toBe(true);
  await thread.getByTestId('pptx-comment-menu').first().click();
  await page.getByTestId('pptx-comment-reopen').click();
  await expect(thread).not.toHaveAttribute('data-resolved', 'true');

  // Ctrl+Alt+M with nothing selected comments on the slide itself.
  await page.keyboard.press('Escape');
  const empty = await screen(page, deck.width - 20, deck.height - 20);
  await page.mouse.click(empty.x, empty.y);
  await page.keyboard.press('Control+Alt+m');
  await page.getByTestId('pptx-comment-draft').fill('Slide-level note');
  await page.keyboard.press('Control+Enter');
  await expect(pane.getByTestId('pptx-comment-thread')).toHaveCount(2);
  await expect(marker).toHaveCount(2);
  list = await comments(page, 0);
  expect(list[1]).toMatchObject({ text: 'Slide-level note' });
  expect(list[1].shape).toBeUndefined();

  // Delete a reply, then a thread, from their menus.
  await thread
    .first()
    .getByTestId('pptx-comment-reply-item')
    .getByTestId('pptx-comment-menu')
    .click();
  await page.getByTestId('pptx-comment-delete').click();
  await expect(pane.getByTestId('pptx-comment-reply-item')).toHaveCount(0);
  await pane
    .getByTestId('pptx-comment-thread')
    .last()
    .getByTestId('pptx-comment-menu')
    .first()
    .click();
  await page.getByTestId('pptx-comment-delete').click();
  await expect(pane.getByTestId('pptx-comment-thread')).toHaveCount(1);

  // Review ▸ Delete ▸ all comments in the presentation.
  await page.getByTestId('pptx-review-delete').click();
  await page.getByTestId('pptx-review-delete-all').click();
  await expect(pane.getByTestId('pptx-comment-thread')).toHaveCount(0);
  await expect(marker).toHaveCount(0);
  await expect(page.getByTestId('pptx-thumbnail-comments')).toHaveCount(0);
  expect(await comments(page, 0)).toHaveLength(0);

  // Undo brings them back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(pane.getByTestId('pptx-comment-thread')).toHaveCount(1);
  expect(await page.evaluate(() => window.pptxFixture.errors())).toEqual([]);
});

test('markers open legacy comments; Previous and Next walk the deck', async ({
  page,
}) => {
  await open(page, SLIDE_FEATURES);
  // Slide 4 has comments; its thumbnail says so.
  await expect(page.getByTestId('pptx-thumbnail-comments')).toHaveCount(1);
  await page.getByTestId('pptx-thumbnail').nth(3).click();
  const markers = page.getByTestId('pptx-comment-marker');
  await expect(markers).toHaveCount(2);
  await markers.nth(1).click();
  const pane = page.getByTestId('pptx-comments-pane');
  await expect(pane).toBeVisible();
  const threads = pane.getByTestId('pptx-comment-thread');
  await expect(threads).toHaveCount(2);
  await expect(threads.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(threads.nth(1).getByTestId('pptx-comment-author')).toHaveText(
    'Corpus Reviewer'
  );
  await expect(threads.nth(1).getByTestId('pptx-comment-text')).toHaveText(
    'Second comment on the same slide.'
  );
  // Legacy comments take no replies.
  await expect(threads.nth(1).getByTestId('pptx-comment-reply')).toHaveCount(0);

  // Next wraps around to the first comment; Previous comes back.
  await page.getByTestId('pptx-tab-review').click();
  await page.getByTestId('pptx-review-next').click();
  await expect(threads.nth(0)).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('pptx-review-previous').click();
  await expect(threads.nth(1)).toHaveAttribute('aria-current', 'true');

  // Insert ▸ Comment on the first slide, then Next goes back to slide 4.
  await page.getByTestId('pptx-thumbnail').nth(0).click();
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-comment').click();
  await page.getByTestId('pptx-comment-draft').fill('Opening slide note');
  await page.getByTestId('pptx-comment-post').click();
  await expect(threads).toHaveCount(1);
  await page.getByTestId('pptx-tab-review').click();
  await page.getByTestId('pptx-review-next').click();
  await expect(page.getByTestId('pptx-thumbnail').nth(3)).toHaveAttribute(
    'aria-current',
    'true'
  );
  await expect(threads.nth(0)).toHaveAttribute('aria-current', 'true');

  // Right-click ▸ New Comment on the slide; Show Comments hides the pane.
  const at = await screen(page, 600, 450);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'New Comment' }).click();
  await page.getByTestId('pptx-comment-draft').fill('From the menu');
  await page.getByTestId('pptx-comment-post').click();
  await expect(threads).toHaveCount(3);
  await page.getByTestId('pptx-review-show-comments').click();
  await expect(pane).toBeHidden();
});

test('underlines misspellings and fixes them from the right-click menu', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-textbox').click();
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.type('Teh quartely report is ready');
  await page.keyboard.press('Escape');
  const teh = page.locator('[data-testid="pptx-squiggle"][data-word="Teh"]');
  await expect(teh).toHaveCount(1);
  await expect(
    page.locator('[data-testid="pptx-squiggle"][data-word="quartely"]')
  ).toHaveCount(1);

  // Right-click the word: suggestions come first.
  const box = await teh.boundingBox();
  if (!box) throw new Error('No underline.');
  await page.mouse.click(box.x + box.width / 2, box.y - 6, {
    button: 'right',
  });
  const suggestion = page.getByTestId('pptx-spelling-menu-suggestion').first();
  await expect(suggestion).toHaveText('The');
  await suggestion.click();
  await expect
    .poll(() => textWith(page, 0, 'report'))
    .toEqual(['The quartely report is ready']);
  await expect(teh).toHaveCount(0);

  // Ignore All drops the other underline (and remembers it in this browser).
  const other = page.locator(
    '[data-testid="pptx-squiggle"][data-word="quartely"]'
  );
  const otherBox = await other.boundingBox();
  if (!otherBox) throw new Error('No underline.');
  await page.mouse.click(otherBox.x + otherBox.width / 2, otherBox.y - 6, {
    button: 'right',
  });
  await page.getByTestId('pptx-spelling-menu-ignore-all').click();
  await expect(other).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('pptx-spelling-ignore-all'))
  ).toBe('["quartely"]');

  // Right-clicking the word put the caret in it, as in PowerPoint.
  await expect(page.getByTestId('pptx-text-input')).toBeFocused();
  // While typing, the word being written is not flagged until it is done.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pptx-text-input')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.type(' tomorow', { delay: 20 });
  await page.waitForTimeout(400);
  await expect(
    page.locator('[data-testid="pptx-squiggle"][data-word="tomorow"]')
  ).toHaveCount(0);
  await page.keyboard.type('.');
  await expect(
    page.locator('[data-testid="pptx-squiggle"][data-word="tomorow"]')
  ).toHaveCount(1);
});

test('F7 walks the deck and Change All fixes every occurrence', async ({
  page,
}) => {
  await open(page);
  const deck = await outline(page);
  await seed(page, [
    {
      op: 'addShape',
      slide: deck.slides[0].id,
      shape: { kind: 'textBox', text: 'Recieve the files' },
      x: 60,
      y: 440,
      w: 300,
      h: 40,
    },
    {
      op: 'addShape',
      slide: deck.slides[1].id,
      shape: { kind: 'textBox', text: 'We recieve them weekly' },
      x: 60,
      y: 440,
      w: 300,
      h: 40,
    },
    {
      op: 'addShape',
      slide: deck.slides[2].id,
      shape: { kind: 'textBox', text: 'Teh end' },
      x: 60,
      y: 470,
      w: 300,
      h: 40,
    },
  ]);
  await page.keyboard.press('F7');
  const pane = page.getByTestId('pptx-spelling-pane');
  await expect(pane).toBeVisible();
  const word = page.getByTestId('pptx-spelling-word');
  // The deck's own proper noun comes first; Ignore All skips it everywhere.
  await expect(word).toHaveText('Northwind');
  await page.getByTestId('pptx-spelling-ignore-all').click();
  await expect(word).toHaveText('Recieve');
  await expect(page.getByTestId('pptx-spelling-suggestion').first()).toHaveText(
    'Receive'
  );
  await expect(
    page.getByTestId('pptx-spelling-suggestion').first()
  ).toHaveAttribute('aria-selected', 'true');
  // The word is selected on its slide.
  await expect(page.getByTestId('pptx-thumbnail').nth(0)).toHaveAttribute(
    'aria-current',
    'true'
  );
  await page.getByTestId('pptx-spelling-change-all').click();
  await expect
    .poll(() => textWith(page, 0, 'files'))
    .toEqual(['Receive the files']);
  expect(await textWith(page, 1, 'weekly')).toEqual(['We receive them weekly']);

  // The walk goes on to the next slides.
  await expect(word).toHaveText('YoY');
  await expect(page.getByTestId('pptx-thumbnail').nth(2)).toHaveAttribute(
    'aria-current',
    'true'
  );
  await page.getByTestId('pptx-spelling-ignore-all').click();
  await expect(word).toHaveText('pts');
  await page.getByTestId('pptx-spelling-ignore-once').click();
  // Change fixes just this occurrence, with the suggestion picked.
  await expect(word).toHaveText('Teh');
  await page.getByTestId('pptx-spelling-suggestion').nth(1).click();
  await expect(
    page.getByTestId('pptx-spelling-suggestion').nth(1)
  ).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('pptx-spelling-suggestion').first().click();
  await page.getByTestId('pptx-spelling-change').click();
  await expect(word).toHaveText('Opex');
  expect(await textWith(page, 2, ' end')).toEqual(['The end']);
  await page.getByTestId('pptx-spelling-add').click();
  await expect(word).toHaveText('unallocated');
  await page.getByTestId('pptx-spelling-ignore-all').click();
  await expect(page.getByTestId('pptx-spelling-complete')).toHaveText(
    /Spell check complete/
  );
  await page.getByTestId('pptx-spelling-ok').click();
  await expect(pane).toBeHidden();
  expect(
    await page.evaluate(() => localStorage.getItem('pptx-spelling-dictionary'))
  ).toBe('["Opex"]');
});
