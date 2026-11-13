import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route(/^http:\/\/localhost:\d+\//, async (route) => {
    await route.fulfill({ response: await route.fetch({ maxRetries: 2 }) });
  });
  await page.route('**/__macro_dev/**', (route) => route.abort());
  // Local container network changes can cancel Vite's initial module requests.
  // Retry only that startup failure, never an editor interaction.
  let networkChanged = false;
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED')
      networkChanged = true;
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    networkChanged = false;
    await page.goto('/src/features/crm/browser-test/editor.html');
    await page.waitForLoadState('networkidle');
    if (!networkChanged) break;
  }
  await expect(page.getByRole('grid', { name: 'Renewals' })).toBeVisible({
    timeout: 30000,
  });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('the pipeline API powers the shared editor and respects column protections and grants', async ({
  page,
}) => {
  await expect(page.getByText('Acme', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await page.getByRole('button', { name: 'Add sort', exact: true }).click();
  await page.getByRole('button', { name: 'Close sort' }).click();
  await expect(page.getByRole('button', { name: 'Sort 1' })).toBeFocused();
  await page.getByRole('button', { name: /^Notes: Follow up\./ }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit Notes' });
  await editor.fill('Renew in October');
  await editor.press('Tab');
  await expect(page.getByLabel('Pipeline writes')).toHaveText('1');
  await page.getByRole('button', { name: 'Add column', exact: true }).click();
  await expect(
    page.getByRole('columnheader', { name: 'Unnamed', exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Pipeline writes')).toHaveText('2');
  await page.keyboard.press('Escape');
  await page
    .getByRole('columnheader', { name: 'Company', exact: true })
    .press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Delete column' })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle editing' }).click();
  await expect(
    page.getByRole('button', { name: 'Add column', exact: true })
  ).toHaveCount(0);
});

test('a cell in a row taller than its value takes clicks across its full height', async ({
  page,
}) => {
  // Wrapped multi-select pills grow a row the same way.
  await page.addStyleTag({ content: '[role="row"] { min-height: 8rem; }' });
  const cell = page
    .getByRole('gridcell')
    .filter({ has: page.getByRole('button', { name: /^Notes: Follow up\./ }) });
  const box = await cell.boundingBox();
  if (!box) throw new Error('Notes cell is not laid out');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
  await expect(page.getByRole('textbox', { name: 'Edit Notes' })).toBeVisible();
});

test('outcome and currency use the shared editor and totals retain the denomination', async ({
  page,
}) => {
  await expect(
    page.getByRole('button', { name: /^Revenue: USD 1,250.5/ })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Outcome: Open/ }).click();
  await page.getByRole('option', { name: 'Won', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^Outcome: Won/ })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Revenue currency: USD/ }).click();
  await expect(
    page.getByRole('button', { name: 'Clear value', exact: true })
  ).toHaveCount(0);
  await page.getByRole('option', { name: 'EUR', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^Revenue: EUR 1,250.5/ })
  ).toBeVisible();
  await expect(page.getByRole('row', { name: 'Table summary' })).toContainText(
    'EUR 1,250.5'
  );
  await page
    .getByRole('columnheader', { name: 'Outcome', exact: true })
    .press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Rename column' })
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).not.toBeVisible();
});

test('record and board editors preserve outcome and currency', async ({
  page,
}) => {
  // The second row is the one holding an outcome and an amount.
  await page
    .getByRole('button', { name: 'Open Linked record', exact: true })
    .nth(1)
    .click();
  const record = page.getByRole('dialog');
  await record.getByRole('button', { name: /^Outcome: Open/ }).click();
  await page.getByRole('option', { name: 'Lost', exact: true }).click();
  await record.getByRole('button', { name: /^Revenue currency: USD/ }).click();
  await page.getByRole('option', { name: 'EUR', exact: true }).click();
  await expect(
    record.getByRole('button', { name: /^Revenue: EUR 1,250.5/ })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close record', exact: true }).click();
  await page.getByRole('button', { name: 'Show board', exact: true }).click();
  await expect(page.getByLabel('Board grouped by Outcome')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New group' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rename Won' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open lane menu' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Delete group' })
  ).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Hide lane' }).click();
  await expect(
    page.getByRole('button', { name: 'Open lane menu' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Change Won color' }).click();
  await expect(page.getByText('Group color', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: /^Revenue: EUR 1,250.5/ })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Outcome: Lost/ }).click();
  await page.getByRole('option', { name: 'Won', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^Outcome: Won/ })
  ).toBeVisible();
});

test('clears editable cells in a range while retaining required outcome and currency', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^Notes: Follow up/ }).click();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: /^Revenue currency: USD/ })
    .click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  await expect(page.getByLabel('Pipeline writes')).toHaveText('1');
  await expect(
    page.getByRole('button', { name: /^Notes: Follow up/ })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Revenue: USD 1,250.5/ })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Outcome: Open/ })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Revenue currency: USD/ })
  ).toBeVisible();
});

test.describe('localized monetary editing', () => {
  test.use({ locale: 'de-DE' });
  test('accepts locale decimals and preserves canonical raw editing', async ({
    page,
  }) => {
    await page
      .getByRole('button', { name: /^Revenue: USD 1.250,5/ })
      .dblclick();
    const amount = page.getByRole('textbox', { name: 'Edit Revenue' });
    await expect(amount).toHaveValue('1250.5');
    await amount.fill('2.345,6789');
    await amount.press('Enter');
    await expect(
      page.getByRole('button', { name: /^Revenue: USD 2.345,6789/ })
    ).toBeVisible();
    await expect(page.getByLabel('Pipeline writes')).toHaveText('1');
    await page
      .getByRole('button', { name: /^Revenue: USD 2.345,6789/ })
      .dblclick();
    await expect(amount).toHaveValue('2345.6789');
    await amount.fill('12.5');
    await amount.press('Enter');
    await expect(
      page.getByRole('button', { name: /^Revenue: USD 12,5/ })
    ).toBeVisible();
    await expect(page.getByLabel('Pipeline writes')).toHaveText('2');
  });
});

test('a wrapping cell opens and closes in place over opaque rows', async ({
  page,
}) => {
  const rows = page.locator('[data-grid-row-id]');
  const heights = () =>
    rows.evaluateAll((elements) =>
      elements.map((row) => row.getBoundingClientRect().height)
    );
  const closed = await heights();
  await page.getByRole('button', { name: /^Notes: Oct 21 emailed/ }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit Notes' });
  await editor.press('End');
  await editor.pressSequentially(' and a follow-up call');
  await expect
    .poll(async () => (await heights())[0])
    .toBeGreaterThan(closed[0]);
  const measure = () =>
    rows.evaluateAll((elements) =>
      elements.map((row) => {
        const box = row.getBoundingClientRect();
        // The row lines beneath the rows are drawn at a fixed pitch; only
        // an opaque row hides them once it grows past it.
        const canvas = document.createElement('canvas').getContext('2d')!;
        canvas.fillStyle = getComputedStyle(row).backgroundColor;
        canvas.fillRect(0, 0, 1, 1);
        const alpha = canvas.getImageData(0, 0, 1, 1).data[3];
        return { top: box.top, bottom: box.bottom, alpha };
      })
    );
  // The grid moves the rows below once its resize observer measures the
  // grown row, which a read straight after the growth can come before.
  await expect
    .poll(async () => {
      const [first, second] = await measure();
      return second.top - first.bottom;
    })
    .toBeCloseTo(0, 0);
  const layout = await measure();
  expect(layout.map(({ alpha }) => alpha)).toEqual(layout.map(() => 255));
  await page.keyboard.press('Escape');
  await expect.poll(heights).toEqual(closed);
});

test('a multi-line note shows every line and takes new lines without leaving its row', async ({
  page,
}) => {
  const cell = page.getByRole('button', { name: /^Notes: Line one/ });
  await expect(cell).toHaveText('Line one Line two Line three');
  await cell.click();
  const editor = page.getByRole('textbox', { name: 'Edit Notes' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Line four');
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.type('Line five');
  // A line started and taken back leaves no line break behind.
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  // Shift+Enter used to save and open the record above, so the next line
  // typed replaced that record's note.
  await expect(editor).toHaveCount(1);
  await expect(editor).toContainText('Line one');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Pipeline writes')).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: /^Notes: Follow up\./ })
  ).toBeVisible();
  const saved = page.getByRole('button', { name: /^Notes: Line one/ });
  await expect(saved).toHaveText(
    'Line one Line two Line three Line four Line five'
  );
  await saved.click();
  expect(await editor.innerText()).toBe(
    'Line one\nLine two\nLine three\nLine four\nLine five'
  );
});

test('arrow keys move through a wrapped note before leaving it', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^Notes: Oct 21 emailed/ }).click();
  const editor = page.getByRole('textbox', { name: 'Edit Notes' });
  await expect(editor).toBeFocused();
  expect((await editor.boundingBox())?.height).toBeGreaterThan(40);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await expect(editor).toContainText('Oct 21 emailed');
  await expect(editor).toBeFocused();
  // From the start of the second line, ArrowUp goes back to the first.
  await page.keyboard.press('ArrowUp');
  await expect(editor).toContainText('Oct 21 emailed');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowDown');
  await expect(editor).toHaveText('Follow up');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Pipeline writes')).toHaveText('0');
});
