import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';

async function open(page: Page, extra = '') {
  await page.goto(
    `/?deck=${encodeURIComponent(KITCHEN_SINK)}&autosave=0${extra}`
  );
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

const sectionNames = async (page: Page) =>
  ((await outline(page)).sections ?? []).map(
    (s) => `${s.name}:${s.slideIds.length}`
  );

test('Header & Footer applies to all, skips title slides, and fixes the date', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-slide-number').click();
  const dialog = page.getByTestId('pptx-header-footer');
  await expect(dialog).toBeVisible();
  // It starts from what the slide shows (the deck's fixed date and footer).
  await expect(page.getByTestId('pptx-hf-slide-number')).toBeChecked();
  await expect(page.getByTestId('pptx-hf-date-fixed')).toBeChecked();
  await expect(page.getByTestId('pptx-hf-footer-text')).toHaveValue(
    'Northwind Analytics · Q3 FY2024'
  );
  await page.getByTestId('pptx-hf-date-fixed-text').fill('Q3 2026');
  await page.getByTestId('pptx-hf-footer-text').fill('Contoso');
  await page.getByTestId('pptx-hf-not-on-title').check();
  await page.getByTestId('pptx-hf-apply-all').click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () =>
      (await outline(page)).slides.map((s) =>
        s.headerFooter
          ? `${s.headerFooter.slideNumber}|${s.headerFooter.dateText}|${s.headerFooter.footerText}`
          : 'none'
      )
    )
    .toEqual([
      'none',
      ...Array.from({ length: 7 }, () => 'true|Q3 2026|Contoso'),
    ]);

  // Apply changes the selected slide only: an automatic date, no footer.
  await page.getByTestId('pptx-thumbnail').nth(1).click();
  await page.getByTestId('pptx-insert-header-footer').click();
  await expect(page.getByTestId('pptx-hf-not-on-title')).toBeChecked();
  await page.getByTestId('pptx-hf-date-auto').check();
  await page.getByTestId('pptx-hf-date-format').selectOption('datetime4');
  await page.getByTestId('pptx-hf-footer').uncheck();
  await expect(page.getByTestId('pptx-hf-footer-text')).toBeDisabled();
  await page.getByTestId('pptx-hf-apply').click();
  await expect
    .poll(async () => {
      const slides = (await outline(page)).slides;
      return [slides[1].headerFooter, slides[2].headerFooter?.footer];
    })
    .toEqual([
      {
        slideNumber: true,
        date: true,
        dateFormat: 'datetime4',
        footer: false,
      },
      true,
    ]);
});

test('the date formats are listed by example', async ({ page }) => {
  await open(page);
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-date-time').click();
  await page.getByTestId('pptx-hf-date-auto').check();
  const options = await page
    .getByTestId('pptx-hf-date-format')
    .locator('option')
    .allTextContents();
  expect(options).toHaveLength(13);
  const now = new Date();
  expect(options[0]).toBe(
    `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`
  );
  expect(options[1]).toContain(String(now.getFullYear()));
});

test('Slide Size: Standard with Ensure Fit scales content and the stage follows', async ({
  page,
}) => {
  await open(page);
  const before = (await outline(page)).slides[0].shapes.find((s) => s.id === 2);
  if (!before) throw new Error('No title on slide 1.');
  await page.getByTestId('pptx-tab-design').click();
  await page.getByTestId('pptx-slide-size').click();
  await page.getByTestId('pptx-slide-size-standard').click();
  await expect(page.getByTestId('pptx-slide-size-scale')).toBeVisible();
  await page.getByTestId('pptx-slide-size-fit').click();
  await expect
    .poll(async () => {
      const deck = await outline(page);
      return [deck.width, deck.height];
    })
    .toEqual([720, 540]);
  const after = (await outline(page)).slides[0].shapes.find((s) => s.id === 2);
  // Ensure Fit: the smaller ratio (720 / 960), centered vertically.
  expect(after?.w).toBeCloseTo(before.w * 0.75, 1);
  expect(after?.x).toBeCloseTo(before.x * 0.75, 1);
  expect(after?.y).toBeCloseTo(before.y * 0.75 + (540 - 540 * 0.75) / 2, 1);
  await expect
    .poll(async () => {
      const box = await page.getByTestId('pptx-stage').boundingBox();
      return box ? Math.round((box.width / box.height) * 100) / 100 : 0;
    })
    .toBe(1.33);
  const thumb = await page.getByTestId('pptx-thumbnail').first().boundingBox();
  expect(thumb && thumb.width / thumb.height).toBeCloseTo(4 / 3, 1);

  // Custom: A4 portrait, maximized.
  await page.getByTestId('pptx-slide-size').click();
  await page.getByTestId('pptx-slide-size-custom').click();
  await expect(page.getByTestId('pptx-slide-size-width')).toHaveValue('10 in');
  await expect(page.getByTestId('pptx-slide-size-preset')).toHaveValue(
    'screen4x3'
  );
  await page.getByTestId('pptx-slide-size-preset').selectOption('a4');
  await page.getByTestId('pptx-slide-size-portrait').check();
  await expect(page.getByTestId('pptx-slide-size-height')).toHaveValue(
    '10.833 in'
  );
  await page.getByTestId('pptx-slide-size-ok').click();
  await page.getByTestId('pptx-slide-size-maximize').click();
  await expect
    .poll(async () => {
      const deck = await outline(page);
      return [deck.width, deck.height];
    })
    .toEqual([540, 780]);
  // A typed size keeps its shape: no question, content scales with it.
  await page.getByTestId('pptx-slide-size').click();
  await page.getByTestId('pptx-slide-size-custom').click();
  await page.getByTestId('pptx-slide-size-width').fill('15');
  await page.getByTestId('pptx-slide-size-height').fill('21.667');
  await page.getByTestId('pptx-slide-size-ok').click();
  await expect(page.getByTestId('pptx-slide-size-scale')).toBeHidden();
  await expect
    .poll(async () => Math.round((await outline(page)).width))
    .toBe(1080);
});

test('sections: add, rename, select, collapse, move, and remove from the rail', async ({
  page,
}) => {
  await open(page);
  const rail = page.getByTestId('pptx-slide-rail');
  const thumbs = rail.getByTestId('pptx-thumbnail');
  const headers = rail.getByTestId('pptx-section-header');

  // Add Section before slide 3; its name is ready to type.
  await thumbs.nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add Section' }).click();
  const rename = page.getByTestId('pptx-section-rename');
  await expect(rename).toBeFocused();
  await expect(rename).toHaveValue('Untitled Section');
  await page.keyboard.type('Results');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => sectionNames(page))
    .toEqual(['Default Section:2', 'Results:6']);
  await expect(headers).toHaveCount(2);
  await expect(headers.nth(1)).toContainText('Results');
  await expect(headers.nth(1)).toContainText('(6)');

  // Rename from the header's menu.
  await headers.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename Section' }).click();
  await expect(rename).toBeFocused();
  await rename.fill('Intro');
  await rename.press('Enter');
  await expect.poll(() => sectionNames(page)).toEqual(['Intro:2', 'Results:6']);

  // Clicking a header selects its slides.
  await headers.nth(1).click();
  await expect(rail.locator('[aria-selected="true"]')).toHaveCount(6);
  await expect(page.getByTestId('pptx-status-selected')).toHaveText(
    '6 slides selected'
  );

  // Collapse hides the section's thumbnails.
  await headers.first().getByTestId('pptx-section-toggle').click();
  await expect(headers.first()).toHaveAttribute('aria-expanded', 'false');
  await expect(thumbs.nth(0)).toBeHidden();
  await expect(thumbs.nth(2)).toBeVisible();
  await page.getByTestId('pptx-section-menu').click();
  await page.getByTestId('pptx-section-collapse-all').click();
  await expect(
    rail.locator('[data-testid="pptx-thumbnail"]:visible')
  ).toHaveCount(0);
  await page.getByTestId('pptx-section-menu').click();
  await page.getByTestId('pptx-section-expand-all').click();
  await expect(
    rail.locator('[data-testid="pptx-thumbnail"]:visible')
  ).toHaveCount(8);

  // Move Section Down takes the slides along.
  await headers.first().click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Move Section Up' })
  ).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Move Section Down' }).click();
  await expect.poll(() => sectionNames(page)).toEqual(['Results:6', 'Intro:2']);
  expect((await outline(page)).slides.map((s) => s.id).slice(-2)).toEqual([
    256, 257,
  ]);

  // The sorter shows the same sections.
  await page.getByTestId('pptx-view-sorter').click();
  const sorter = page.getByTestId('pptx-slide-sorter');
  await expect(sorter.getByTestId('pptx-section-header')).toHaveCount(2);
  await expect(sorter.getByTestId('pptx-section-header').first()).toContainText(
    'Results'
  );
  await page.getByTestId('pptx-view-normal').click();

  // Remove Section: its slides join the previous section.
  await headers.nth(1).click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Remove Section', exact: true })
    .click();
  await expect.poll(() => sectionNames(page)).toEqual(['Results:8']);
  await page.getByTestId('pptx-section-menu').click();
  await page.getByTestId('pptx-section-remove-all').click();
  await expect.poll(async () => (await outline(page)).sections).toBeUndefined();
  await expect(headers).toHaveCount(0);
});

test('sections: Home ▸ Section adds and renames; Remove Section & Slides', async ({
  page,
}) => {
  await open(page);
  const rail = page.getByTestId('pptx-slide-rail');
  await rail.getByTestId('pptx-thumbnail').nth(6).click();
  await page.getByTestId('pptx-section-menu').click();
  await page.getByTestId('pptx-section-add').click();
  await expect(page.getByTestId('pptx-section-rename')).toBeFocused();
  // Escape keeps the name.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pptx-section-rename')).toBeHidden();
  await expect
    .poll(() => sectionNames(page))
    .toEqual(['Default Section:6', 'Untitled Section:2']);
  await page.getByTestId('pptx-section-menu').click();
  await page.getByTestId('pptx-section-rename-current').click();
  await page.getByTestId('pptx-section-rename').fill('Appendix');
  await page.getByTestId('pptx-section-rename').press('Enter');
  await expect
    .poll(() => sectionNames(page))
    .toEqual(['Default Section:6', 'Appendix:2']);
  const appendix = rail.getByTestId('pptx-section-header').nth(1);
  await appendix.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove Section & Slides' }).click();
  await expect.poll(async () => (await outline(page)).slides.length).toBe(6);
  await expect.poll(() => sectionNames(page)).toEqual(['Default Section:6']);
  // One undo brings back the section and its slides.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(() => sectionNames(page))
    .toEqual(['Default Section:6', 'Appendix:2']);
});

test('read-only viewers see deck setup disabled', async ({ page }) => {
  await open(page, '&readonly');
  await page.getByTestId('pptx-tab-insert').click();
  await expect(page.getByTestId('pptx-insert-header-footer')).toBeDisabled();
  await page.getByTestId('pptx-tab-design').click();
  await expect(page.getByTestId('pptx-slide-size')).toBeDisabled();
  await page.getByTestId('pptx-tab-home').click();
  await expect(page.getByTestId('pptx-section-menu')).toBeDisabled();
});
