import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';

async function open(page: Page) {
  await page.goto(`/?deck=${encodeURIComponent(KITCHEN_SINK)}&autosave=0`);
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

/** The SmartArt graphic on slide 1, if there is one. */
async function graphic(page: Page) {
  const deck = await outline(page);
  return deck.slides[0].shapes.find((s) => s.smartArt);
}

/** The graphic's nodes as `[text, level]`. */
async function nodes(page: Page) {
  return (await graphic(page))?.smartArt?.nodes.map((n) => [n.text, n.level]);
}

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const deck = await outline(page);
  const scale = box.width / deck.width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

/** Inserts a SmartArt graphic from Insert ▸ SmartArt. */
async function insert(page: Page, category: string, layout: string) {
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-smartart').click();
  await expect(page.getByTestId('pptx-smartart-dialog')).toBeVisible();
  await page.getByTestId(`pptx-smartart-category-${category}`).click();
  await page.getByTestId(`pptx-smartart-layout-${layout}`).click();
  await page.getByTestId('pptx-smartart-ok').click();
  await expect(page.getByTestId('pptx-smartart-dialog')).toBeHidden();
}

test('inserts a SmartArt graphic and edits it like PowerPoint', async ({
  page,
}) => {
  await open(page);
  await insert(page, 'process', 'process1');

  // A Basic Process with three "[Text]" prompts and its Text Pane open.
  await expect.poll(async () => (await graphic(page))?.kind).toBe('diagram');
  expect((await graphic(page))?.smartArt?.layout.name).toBe('Basic Process');
  await expect(page.getByTestId('pptx-smartart-prompt')).toHaveCount(3);
  const pane = page.getByTestId('pptx-smartart-pane');
  await expect(pane).toBeVisible();
  const lines = pane.getByTestId('pptx-smartart-pane-line');
  await expect(lines).toHaveCount(3);

  // Type three items; the arrow keys move between bullets.
  await expect(lines.nth(0)).toBeFocused();
  await page.keyboard.type('Plan');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('Build');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('Ship');
  await expect
    .poll(() => nodes(page))
    .toEqual([
      ['Plan', 1],
      ['Build', 1],
      ['Ship', 1],
    ]);
  await expect(page.getByTestId('pptx-smartart-prompt')).toHaveCount(0);

  // Enter adds a step after the bullet, with the caret in it.
  await page.keyboard.press('Enter');
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(3)).toBeFocused();
  await page.keyboard.type('Review');
  await expect
    .poll(async () => (await nodes(page))?.[3])
    .toEqual(['Review', 1]);

  // SmartArt Design ▸ Add Shape ▸ After, then Demote the new shape.
  await page.getByTestId('pptx-tab-smartart-design').click();
  await page.getByTestId('pptx-smartart-add-shape').click();
  await page.getByTestId('pptx-smartart-add-after').click();
  await expect(lines).toHaveCount(5);
  await page.getByTestId('pptx-smartart-demote').click();
  await expect.poll(async () => (await nodes(page))?.[4]).toEqual(['', 2]);
  await lines.nth(4).fill('Retro');
  await expect
    .poll(() => nodes(page))
    .toEqual([
      ['Plan', 1],
      ['Build', 1],
      ['Ship', 1],
      ['Review', 1],
      ['Retro', 2],
    ]);
  await expect(lines.nth(4).locator('xpath=..')).toHaveAttribute(
    'data-level',
    '2'
  );

  // Tab and Shift+Tab in the pane demote and promote.
  await lines.nth(4).press('Shift+Tab');
  await expect.poll(async () => (await nodes(page))?.[4]).toEqual(['Retro', 1]);
  await lines.nth(4).press('Tab');
  await expect.poll(async () => (await nodes(page))?.[4]).toEqual(['Retro', 2]);

  // Change Layout to Basic Cycle: the text and levels stay.
  await page.getByTestId('pptx-smartart-layouts').click();
  await page.getByTestId('pptx-smartart-layout-option-cycle2').click();
  await expect
    .poll(async () => (await graphic(page))?.smartArt?.layout.name)
    .toBe('Basic Cycle');
  expect((await nodes(page))?.map((n) => n[0])).toEqual([
    'Plan',
    'Build',
    'Ship',
    'Review',
    'Retro',
  ]);

  // Change Colors to Colorful.
  await page.getByTestId('pptx-smartart-colors').click();
  await page.getByTestId('pptx-smartart-colors-colorful1').click();
  await expect
    .poll(async () => (await graphic(page))?.smartArt?.colors)
    .toMatch(/colorful1$/);

  // Click a node on the stage and type: its text is replaced in place.
  const shape = await graphic(page);
  const plan = shape?.smartArt?.nodes.find((n) => n.text === 'Plan');
  if (!shape || !plan?.frame) throw new Error('The first node has no frame.');
  const [fx, fy, fw, fh] = plan.frame;
  const at = await screen(page, shape.x + fx + fw / 2, shape.y + fy + fh / 2);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('pptx-smartart-active-node')).toHaveAttribute(
    'data-node',
    plan.id
  );
  await page.keyboard.type('Design');
  await expect(page.getByTestId('pptx-smartart-node-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pptx-smartart-node-input')).toBeHidden();
  await expect
    .poll(async () => (await nodes(page))?.[0])
    .toEqual(['Design', 1]);

  // The right-click menu offers SmartArt commands.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Change Layout' })
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Reset Graphic' })
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // Convert ▸ Convert to Shapes: a group of plain shapes with the text.
  await page.getByTestId('pptx-tab-smartart-design').click();
  await page.getByTestId('pptx-smartart-convert').click();
  await page.getByTestId('pptx-smartart-convert-shapes').click();
  await expect.poll(async () => !!(await graphic(page))).toBe(false);
  const text = (s: { paragraphs?: { text: string }[] }) =>
    (s.paragraphs ?? []).map((p) => p.text).join('\n');
  const group = (await outline(page)).slides[0].shapes.find(
    (s) =>
      s.kind === 'group' &&
      (s.children ?? []).some((c) => text(c).includes('Design'))
  );
  expect(group?.children?.length).toBeGreaterThan(4);
  expect(await page.evaluate(() => window.pptxFixture.errors())).toEqual([]);
});

test('keys typed right after Enter go into the new bullet', async ({
  page,
}) => {
  await open(page);
  await insert(page, 'process', 'process1');
  const lines = page
    .getByTestId('pptx-smartart-pane')
    .getByTestId('pptx-smartart-pane-line');
  await expect(lines.nth(0)).toBeFocused();
  // No pause after Enter: the new bullet is still being made.
  await page.keyboard.type('Ship');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Learn');
  await expect
    .poll(async () => (await nodes(page))?.slice(0, 2))
    .toEqual([
      ['Ship', 1],
      ['Learn', 1],
    ]);
  await expect(lines.nth(1)).toBeFocused();
  await expect(lines.nth(1)).toHaveValue('Learn');
});

test('Backspace on an empty bullet deletes its node', async ({ page }) => {
  await open(page);
  await insert(page, 'list', 'vList2');
  const lines = page
    .getByTestId('pptx-smartart-pane')
    .getByTestId('pptx-smartart-pane-line');
  // Two headings, each with one bullet.
  await expect(lines).toHaveCount(4);
  await lines.nth(1).click();
  await page.keyboard.press('Backspace');
  await expect
    .poll(() => nodes(page))
    .toEqual([
      ['', 1],
      ['', 1],
      ['', 2],
    ]);
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toBeFocused();

  // Closing the pane right after typing still sends the text.
  await lines.nth(0).fill('Alpha');
  await page.getByTestId('pptx-smartart-pane-close').click();
  await expect(page.getByTestId('pptx-smartart-pane')).toBeHidden();
  await expect.poll(async () => (await nodes(page))?.[0]).toEqual(['Alpha', 1]);
});
