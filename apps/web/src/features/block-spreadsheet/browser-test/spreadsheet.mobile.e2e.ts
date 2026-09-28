import { expect, type Locator, type Page, test } from '@playwright/test';

type Point = { x: number; y: number };

const cell = (page: Page, address: string) =>
  page.locator(`[data-address="${address}"]`);
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
const formulaBar = (page: Page) =>
  page.getByRole('textbox', { name: 'Formula bar', exact: true });
const addressBar = (page: Page) =>
  page.getByRole('textbox', { name: 'Go to cell', exact: true });

async function center(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Touch target is not visible.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Chromium delivers trusted touch input, including native scroll/pointercancel. */
async function androidDrag(page: Page, from: Point, to: Point) {
  const session = await page.context().newCDPSession(page);
  const touch = (point: Point) => ({ ...point, id: 1, radiusX: 4, radiusY: 4 });
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touch(from)],
    });
    for (let step = 1; step <= 12; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          touch({
            x: from.x + ((to.x - from.x) * step) / 12,
            y: from.y + ((to.y - from.y) * step) / 12,
          }),
        ],
      });
      // Gesture cadence matters: dispatching the entire swipe in one frame
      // does not exercise the browser's scroll recognition.
      await page.waitForTimeout(16);
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

/** WebKit exposes touch taps, but no trusted touch drag API. */
async function webkitPointerHandleDrag(page: Page, handle: Locator, to: Point) {
  const from = await center(handle);
  // A browser mouse pointer exercises handle hit-testing and pointer capture;
  // it does not prove iOS native touch scrolling or gesture arbitration.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function dragHandle(
  page: Page,
  browserName: string,
  handle: Locator,
  destination: Locator
) {
  const to = await center(destination);
  if (browserName === 'chromium')
    await androidDrag(page, await center(handle), to);
  else await webkitPointerHandleDrag(page, handle, to);
}

async function tapMenu(page: Page, name: string, item: string) {
  await button(page, name).tap();
  await page.getByRole('menuitem', { name: item, exact: true }).tap();
}

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  // Mobile dialogs animate up from outside the viewport. Visibility alone
  // does not wait for that entrance animation to reach its final position.
  await expect(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('Viewport target is missing.');
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }).toPass({ timeout: 5_000 });
}

test.beforeEach(async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok(), 'The fixture must be served successfully.').toBe(true);
  await expect(page.locator('html')).toHaveAttribute(
    'data-touch-device',
    'true'
  );
  await expect(page.getByRole('grid', { name: 'Spreadsheet' })).toBeVisible();
  await expect(cell(page, 'B4')).toHaveText('30');
});

test('native Android swipes scroll the grid without selecting a range', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'WebKit has no trusted touch-drag API.'
  );
  await cell(page, 'B2').tap();
  await expect(addressBar(page)).toHaveValue('B2');
  const before = await page.evaluate(() =>
    window.spreadsheetFixture.snapshot()
  );
  const ribbon = page.getByRole('toolbar', { name: 'Spreadsheet formatting' });
  const ribbonBox = await ribbon.boundingBox();
  if (!ribbonBox) throw new Error('Formatting ribbon is missing.');
  await androidDrag(
    page,
    {
      x: ribbonBox.x + ribbonBox.width - 35,
      y: ribbonBox.y + ribbonBox.height / 2,
    },
    { x: ribbonBox.x + 35, y: ribbonBox.y + ribbonBox.height / 2 }
  );
  await expect
    .poll(() => ribbon.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(80);
  expect(
    await page.evaluate(() => window.spreadsheetFixture.snapshot())
  ).toEqual(before);
  await expect(page.getByRole('menu')).toBeHidden();
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  const box = await grid.boundingBox();
  if (!box) throw new Error('Grid is missing.');
  await androidDrag(
    page,
    { x: box.x + 100, y: box.y + box.height * 0.8 },
    { x: box.x + 100, y: box.y + box.height * 0.3 }
  );
  await expect
    .poll(() => grid.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  await expect(addressBar(page)).toHaveValue('B2');
  await expect(page.getByRole('textbox', { name: 'Edit B2' })).toBeHidden();

  await androidDrag(
    page,
    { x: box.x + box.width - 35, y: box.y + box.height / 2 },
    { x: box.x + 65, y: box.y + box.height / 2 }
  );
  await expect
    .poll(() => grid.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(80);
  await expect(addressBar(page)).toHaveValue('B2');
});

test('touch taps select, edit, apply, and cancel cell drafts', async ({
  page,
}) => {
  await cell(page, 'B2').tap();
  await expect(cell(page, 'B2')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Edit B2' })).toBeHidden();
  await cell(page, 'B2').tap();
  const input = page.getByRole('textbox', { name: 'Edit B2' });
  await expect(input).toBeFocused();
  await input.fill('42');
  await button(page, 'Apply edit').tap();
  await expect(cell(page, 'B2')).toHaveText('42');
  await expect(cell(page, 'B4')).toHaveText('62');

  await formulaBar(page).tap();
  await formulaBar(page).fill('99');
  await button(page, 'Cancel edit').tap();
  await expect(cell(page, 'B2')).toHaveText('42');
  await expect(formulaBar(page)).toHaveValue('42');
});

test('selection handles extend a range (WebKit drag uses a mouse pointer)', async ({
  page,
  browserName,
}) => {
  await cell(page, 'A2').tap();
  const handle = button(page, 'Move selection end');
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await dragHandle(page, browserName, handle, cell(page, 'B4'));
  await expect(addressBar(page)).toHaveValue('A2:B4');
  await expect(cell(page, 'A2')).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, 'B4')).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, 'B5')).toHaveAttribute('aria-selected', 'false');
});

test('touch formula suggestions and reference handles retain the editor (WebKit drag uses a mouse pointer)', async ({
  page,
  browserName,
}) => {
  await cell(page, 'A6').tap();
  const input = formulaBar(page);
  await input.tap();
  if (browserName === 'chromium') {
    await input.fill('=S');
    const list = page.getByRole('listbox', { name: 'Formula suggestions' });
    await expect(list).toBeVisible();
    const box = await list.boundingBox();
    if (!box) throw new Error('Formula suggestions are missing.');
    await androidDrag(
      page,
      { x: box.x + box.width / 2, y: box.y + box.height - 15 },
      { x: box.x + box.width / 2, y: box.y + 15 }
    );
    await expect
      .poll(() => list.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await expect(input).toHaveValue('=S');
    await expect(input).toBeFocused();
  }
  await input.fill('=SU');
  await expect(input).toHaveAttribute('autocapitalize', 'off');
  await expect(input).toHaveAttribute('autocorrect', 'off');
  const suggestions = page.getByRole('listbox', {
    name: 'Formula suggestions',
  });
  await expectInsideViewport(page, suggestions);
  await suggestions.getByRole('option', { name: /^SUM\s/ }).tap();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('=SUM(');
  await cell(page, 'B2').tap();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('=SUM(B2');
  await dragHandle(
    page,
    browserName,
    button(page, 'Move reference end'),
    cell(page, 'B3')
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('=SUM(B2:B3');
  await input.fill('=SUM(B2:B3)');
  await button(page, 'Apply edit').tap();
  await expect(cell(page, 'A6')).toHaveText('30');
});

test('touch formatting and sheet navigation preserve workbook state', async ({
  page,
}) => {
  await cell(page, 'B2').tap();
  await button(page, 'Bold').tap();
  await expect(cell(page, 'B2')).toHaveCSS('font-weight', '600');
  await tapMenu(page, 'Number format', 'Currency $1,234.00');
  await expect(cell(page, 'B2')).toHaveText('$10.00');
  await button(page, 'Add sheet').tap();
  await expect(
    page.getByRole('tab', { name: 'Sheet2', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await tapMenu(page, 'Sheet actions for Sheet2', 'Rename');
  const name = page.getByRole('textbox', { name: 'Sheet name' });
  await name.fill('Forecast');
  await expectInsideViewport(page, page.getByRole('dialog'));
  await button(page, 'Save name').tap();
  await expect(
    page.getByRole('tab', { name: 'Forecast', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).tap();
  await expect(cell(page, 'B2')).toHaveText('$10.00');
  await button(page, 'Find and replace').tap();
  const dialog = page.getByRole('dialog');
  await expectInsideViewport(page, dialog);
  await page.getByRole('textbox', { name: 'Find in sheet' }).fill('Design');
  await button(page, 'Find next').tap();
  await expect(dialog.getByRole('status')).toContainText('1 of 1 matches');
  await button(page, 'Close find and replace').tap();
  await expect(dialog).toBeHidden();
  await expect(addressBar(page)).toHaveValue('A2');
});

test('viewer touch controls keep editing disabled while allowing selection and downloads', async ({
  page,
}) => {
  await page.evaluate(() => window.spreadsheetFixture.setReadonly(true));
  await cell(page, 'B2').tap();
  await cell(page, 'B2').tap();
  await expect(page.getByRole('textbox', { name: 'Edit B2' })).toBeHidden();
  await expect(formulaBar(page)).toHaveAttribute('readonly', '');
  for (const name of ['Bold', 'Add sheet', 'Paste special', 'Format and data'])
    await expect(button(page, name)).toBeDisabled();
  await button(page, 'Import and export').tap();
  await expect(
    page.getByRole('menuitem', { name: 'Import…', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('menuitem', {
      name: 'Download as Excel (.xlsx)',
      exact: true,
    })
  ).toBeEnabled();
  await expect(cell(page, 'B2')).toHaveText('10');
});

test('phone footer and edit actions stay reachable in landscape and a reduced keyboard viewport', async ({
  page,
}) => {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 844, height: 390 },
    // Models the smaller layout viewport, not the actual OS software keyboard.
    { width: 390, height: 430 },
  ]) {
    await page.setViewportSize(viewport);
    const files = button(page, 'Import and export');
    await expectInsideViewport(page, files);
    const box = await files.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    if (!box) throw new Error('Footer button is missing.');
    expect(viewport.width - box.x - box.width).toBeLessThanOrEqual(16);
    expect(viewport.height - box.y - box.height).toBeLessThanOrEqual(12);
    await expectInsideViewport(page, button(page, 'Add sheet'));
    await files.tap();
    await expectInsideViewport(page, page.getByRole('menu'));
    await page.keyboard.press('Escape');
    await formulaBar(page).tap();
    await formulaBar(page).fill('=SU');
    await expectInsideViewport(page, button(page, 'Apply edit'));
    await expectInsideViewport(page, button(page, 'Cancel edit'));
    await expectInsideViewport(
      page,
      page.getByRole('listbox', { name: 'Formula suggestions' })
    );
    await button(page, 'Cancel edit').tap();
  }
});
