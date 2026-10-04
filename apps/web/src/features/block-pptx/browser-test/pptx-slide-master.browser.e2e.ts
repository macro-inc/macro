import type { SlideOutline } from '@core/pptx-engine/types';
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

/** A slide by position, or a master or layout by id. */
function pageOutline(page: Page, index: number): Promise<SlideOutline> {
  return page.evaluate(async (i) => {
    const engine = window.pptxFixture.engine();
    if (!engine) throw new Error('No presentation is open.');
    return engine.slideOutline(i);
  }, index);
}

/** The first run of a shape's text, as the engine lays it out. */
function firstRun(page: Page, index: number, shape: number) {
  return page.evaluate(
    async ([i, id]) => {
      const engine = window.pptxFixture.engine();
      if (!engine) throw new Error('No presentation is open.');
      return (await engine.textLayout(i, id))?.styles[0]?.runs[0];
    },
    [index, shape] as const
  );
}

async function layoutNames(page: Page) {
  return ((await outline(page)).masters ?? []).flatMap((m) =>
    m.layouts.map((l) => l.name)
  );
}

/** Screen position of a slide point on the stage. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const scale = box.width / (await outline(page)).width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

const current = (page: Page) =>
  page.locator('[data-testid="pptx-master-thumbnail"][aria-current="true"]');

async function openSlideMaster(page: Page) {
  await page.getByTestId('pptx-tab-view').click();
  await page.getByTestId('pptx-view-slide-master').click();
  await expect(page.getByTestId('pptx-master-rail')).toBeVisible();
  await expect(page.getByTestId('pptx-tab-slide-master')).toHaveAttribute(
    'aria-selected',
    'true'
  );
}

async function selectLayout(page: Page, name: string) {
  const layout = ((await outline(page)).masters ?? [])
    .flatMap((m) => m.layouts)
    .find((l) => l.name === name);
  if (!layout) throw new Error(`No layout ${name}.`);
  await page
    .locator(
      `[data-testid="pptx-master-thumbnail"][data-page-id="${layout.id}"]`
    )
    .click();
  await expect(current(page)).toHaveAttribute(
    'data-page-id',
    String(layout.id)
  );
  return layout;
}

test("formatting a layout's title in Slide Master view changes its slides", async ({
  page,
}) => {
  await open(page);
  // Slide 3 uses the "Title Only" layout.
  await page.getByTestId('pptx-thumbnail').nth(2).click();
  await openSlideMaster(page);
  await expect(page.getByTestId('pptx-slide-rail')).toBeHidden();
  await expect(page.getByTestId('pptx-status-master')).toHaveText(
    'Slide Master'
  );
  const thumbs = page.getByTestId('pptx-master-thumbnail');
  await expect(thumbs).toHaveCount(12);
  await expect(thumbs.first()).toHaveAttribute('data-kind', 'master');
  await expect(thumbs.first()).toHaveAttribute(
    'title',
    'Office Theme Slide Master: used by slide(s) 1-8'
  );
  // It opens on the slide's layout, which says who uses it.
  const deck = await outline(page);
  const titleOnly = deck.masters?.[0].layouts.find(
    (l) => l.name === 'Title Only'
  );
  if (!titleOnly) throw new Error('No Title Only layout.');
  await expect(current(page)).toHaveAttribute(
    'data-page-id',
    String(titleOnly.id)
  );
  await expect(current(page)).toHaveAttribute(
    'title',
    'Title Only Layout: used by slide(s) 3-8'
  );
  await expect(page.getByTestId('pptx-placeholder-outlines')).toBeVisible();

  // Select the layout's title placeholder: bold, then red.
  const layout = await pageOutline(page, titleOnly.id);
  const title = layout.shapes.find((s) => s.placeholder === 'title');
  if (!title) throw new Error('The layout has no title.');
  const at = await screen(page, title.x + title.w / 2, title.y + title.h / 2);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Control+b');
  await expect
    .poll(async () => (await firstRun(page, titleOnly.id, title.id))?.bold)
    .toBe(true);
  await page.getByTestId('pptx-tab-home').click();
  // No slides to add here: Home's Slides group is not shown.
  await expect(page.getByTestId('pptx-new-slide')).toBeHidden();
  await page.getByTestId('pptx-text-color').click();
  await page.getByRole('button', { name: 'Red', exact: true }).click();
  await expect
    .poll(async () => (await firstRun(page, titleOnly.id, title.id))?.color)
    .toBe('#FF0000');

  // Back on the slides (the status bar's Normal view closes Slide Master
  // view too): slide 3's title follows its layout.
  await page.getByTestId('pptx-view-normal').click();
  await expect(page.getByTestId('pptx-slide-rail')).toBeVisible();
  await expect(page.getByTestId('pptx-new-slide')).toBeVisible();
  await expect(page.getByTestId('pptx-master-rail')).toBeHidden();
  await expect(page.getByTestId('pptx-status-slide')).toHaveText(
    'Slide 3 of 8'
  );
  const slide = await pageOutline(page, 2);
  const slideTitle = slide.shapes.find((s) => s.placeholder === 'title');
  if (!slideTitle) throw new Error('Slide 3 has no title.');
  const run = await firstRun(page, 2, slideTitle.id);
  expect(run?.bold).toBe(true);
  expect(run?.color).toBe('#FF0000');
  // Slides on other layouts keep theirs.
  const first = await pageOutline(page, 0);
  const firstTitle = first.shapes.find((s) => s.placeholder === 'ctrTitle');
  if (!firstTitle) throw new Error('Slide 1 has no title.');
  expect((await firstRun(page, 0, firstTitle.id))?.color).not.toBe('#FF0000');
  expect(await page.evaluate(() => window.pptxFixture.errors())).toEqual([]);
});

test('Slide Master view inserts, renames, duplicates, and deletes layouts and placeholders', async ({
  page,
}) => {
  await open(page);
  await openSlideMaster(page);
  const thumbs = page.getByTestId('pptx-master-thumbnail');

  // A used layout cannot be deleted; an unused one can.
  await selectLayout(page, 'Title Only');
  await expect(page.getByTestId('pptx-master-delete')).toBeDisabled();
  await selectLayout(page, 'Blank');
  await expect(page.getByTestId('pptx-master-delete')).toBeEnabled();

  // Insert Layout adds "Custom Layout" after the selected one, and opens it.
  await page.getByTestId('pptx-master-insert-layout').click();
  await expect(thumbs).toHaveCount(13);
  const names = await layoutNames(page);
  expect(names[names.indexOf('Blank') + 1]).toBe('Custom Layout');
  const custom = ((await outline(page)).masters ?? [])[0].layouts.find(
    (l) => l.name === 'Custom Layout'
  );
  if (!custom) throw new Error('No new layout.');
  await expect(current(page)).toHaveAttribute(
    'data-page-id',
    String(custom.id)
  );
  expect(custom.placeholders).toEqual(['title', 'dt', 'ftr', 'sldNum']);
  await expect(page.getByTestId('pptx-master-title')).toBeChecked();
  await expect(page.getByTestId('pptx-master-footers')).toBeChecked();

  // Insert Placeholder ▸ Picture puts a picture placeholder on it, selected.
  await page.getByTestId('pptx-master-insert-placeholder').click();
  await page.getByTestId('pptx-master-placeholder-picture').click();
  await expect
    .poll(async () =>
      (await pageOutline(page, custom.id)).shapes.map((s) => s.placeholder)
    )
    .toEqual(['title', 'dt', 'ftr', 'sldNum', 'pic']);
  await expect(page.getByTestId('pptx-selection')).toBeVisible();

  // The Title checkbox removes and restores its title.
  await page.getByTestId('pptx-master-title').uncheck();
  await expect
    .poll(async () =>
      (await pageOutline(page, custom.id)).shapes.map((s) => s.placeholder)
    )
    .toEqual(['dt', 'ftr', 'sldNum', 'pic']);
  await page.getByTestId('pptx-master-title').check();
  await expect(page.getByTestId('pptx-master-title')).toBeChecked();

  // Hide Background Graphics.
  await page.getByTestId('pptx-master-hide-background').check();
  await expect
    .poll(async () => {
      const layouts = (await outline(page)).masters?.[0].layouts ?? [];
      return layouts.find((l) => l.id === custom.id)?.hideBackgroundGraphics;
    })
    .toBe(true);
  await expect(page.getByTestId('pptx-master-hide-background')).toBeChecked();

  // Rename.
  await page.getByTestId('pptx-master-rename').click();
  await expect(page.getByTestId('pptx-rename-layout-name')).toBeFocused();
  await expect(page.getByTestId('pptx-rename-layout-name')).toHaveValue(
    'Custom Layout'
  );
  await page.getByTestId('pptx-rename-layout-name').fill('Quarterly Picture');
  await page.getByTestId('pptx-rename-layout-ok').click();
  await expect.poll(() => layoutNames(page)).toContain('Quarterly Picture');
  await expect(current(page)).toHaveAttribute(
    'title',
    'Quarterly Picture Layout: used by no slides'
  );

  // Right-click ▸ Duplicate Layout copies it next to itself.
  await current(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate Layout' }).click();
  await expect(thumbs).toHaveCount(14);
  await expect
    .poll(async () => {
      const list = await layoutNames(page);
      return list[list.indexOf('Quarterly Picture') + 1];
    })
    .toBe('1_Quarterly Picture');

  // Delete the unused "Blank" layout.
  await selectLayout(page, 'Blank');
  await page.getByTestId('pptx-master-delete').click();
  await expect(thumbs).toHaveCount(13);
  expect(await layoutNames(page)).not.toContain('Blank');

  // Undo brings it back; redo deletes it again.
  await page.keyboard.press('Control+z');
  await expect(thumbs).toHaveCount(14);
  await page.keyboard.press('Control+Shift+z');
  await expect(thumbs).toHaveCount(13);

  // Close Master View: a new slide on the new layout gets its placeholders.
  await page.getByTestId('pptx-master-close').click();
  await expect(page.getByTestId('pptx-slide-rail')).toBeVisible();
  await page.getByTestId('pptx-new-slide-layout').click();
  await page
    .getByRole('button', { name: 'Quarterly Picture', exact: true })
    .click();
  await expect(page.getByTestId('pptx-thumbnail')).toHaveCount(9);
  await expect
    .poll(async () => {
      const deck = await outline(page);
      return deck.slides
        .find((s) => s.layout === 'Quarterly Picture')
        ?.shapes.map((s) => s.placeholder);
    })
    .toEqual(['title', 'pic']);
  expect(await page.evaluate(() => window.pptxFixture.errors())).toEqual([]);
});
