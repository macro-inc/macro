import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/features/block-database/browser-test/table.html', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
});

test('keeps the active editor through remote data/schema updates and saved-view changes', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^Name: First\./ }).dblclick();
  const input = page.getByRole('textbox', { name: 'Edit Name' });
  await input.fill('Draft name');
  await input.evaluate((element) =>
    element.setAttribute('data-original-editor', 'true')
  );
  await page
    .getByRole('button', { name: 'Remote update', exact: true })
    .click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Draft name');
  await expect(input).toHaveAttribute('data-original-editor', 'true');
  await input.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Edit Notes' })).toBeFocused();
  await expect(page.getByLabel('Writes', { exact: true })).toHaveText('1');
  await page.getByRole('textbox', { name: 'Edit Notes' }).press('Escape');
  await page.getByRole('button', { name: 'Switch view' }).click();
  const headers = page.getByRole('columnheader');
  await expect(headers.nth(1)).toHaveAttribute('aria-label', 'Status');
  await expect(headers.nth(3)).toHaveAttribute('aria-label', 'Name');
  await expect(
    page.getByRole('button', { name: /^Name: Draft name\./ })
  ).toBeVisible();
});

test('resizes from the rendered width and saves once on release', async ({
  page,
}) => {
  const header = page.getByRole('columnheader', { name: 'Name', exact: true });
  const before = (await header.boundingBox())!;
  const handle = (await page
    .getByRole('separator', { name: 'Resize Name' })
    .boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 70,
    handle.y + handle.height / 2,
    { steps: 5 }
  );
  await expect
    .poll(async () => Math.round((await header.boundingBox())!.width))
    .toBe(Math.round(before.width + 70));
  await expect(page.getByLabel('Resize saves')).toHaveText('0');
  await page.mouse.up();
  await expect(page.getByLabel('Resize saves')).toHaveText('1');
  await expect
    .poll(async () => Math.round((await header.boundingBox())!.width))
    .toBe(Math.round(before.width + 70));
});

test('keeps an unsafe integer draft instead of saving a rounded value', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^Amount: 12\./ }).click();
  const input = page.getByRole('textbox', { name: 'Edit Amount' });
  await input.fill('9007199254740993');
  await input.press('Tab');
  await expect(page.getByRole('alert')).toHaveText('Enter a valid number');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('9007199254740993');
  await expect(page.getByLabel('Writes', { exact: true })).toHaveText('0');

  await input.fill('1.25e3');
  await input.press('Enter');
  await expect(page.getByLabel('Writes', { exact: true })).toHaveText('1');
  await expect(
    page.getByRole('button', { name: /^Amount: 1,250\./ })
  ).toBeFocused();
});

test('sorts through the column menu and keeps sorting when switching layouts', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Notes column menu' }).click();
  await page.getByRole('menuitem', { name: /Sort descending/ }).click();
  await expect(
    page.getByRole('columnheader', { name: 'Notes', exact: true })
  ).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: 'Switch view' }).click();
  await expect(
    page.getByRole('columnheader', { name: 'Notes', exact: true })
  ).toBeVisible();
});

test.describe('touch resizing', () => {
  test.use({ hasTouch: true });
  test('previews and persists a touch drag', async ({ page }) => {
    const header = page.getByRole('columnheader', {
      name: 'Name',
      exact: true,
    });
    const before = (await header.boundingBox())!;
    const handle = (await page
      .getByRole('separator', { name: 'Resize Name' })
      .boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + 60, y }],
    });
    await expect
      .poll(async () => Math.round((await header.boundingBox())!.width))
      .toBe(Math.round(before.width + 60));
    await expect(page.getByLabel('Resize saves')).toHaveText('0');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect(page.getByLabel('Resize saves')).toHaveText('1');
    await session.detach();
  });
});

test('starts ArrowUp at the last select option and saves it with Enter', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Status: Open' }).click();
  const search = page.getByRole('combobox', { name: 'Search Status options' });
  await expect(search).toBeFocused();
  await search.press('ArrowUp');
  await expect(page.getByRole('option', { name: 'Done' })).toHaveAttribute(
    'data-active',
    ''
  );
  await search.press('Enter');
  await expect(page.getByLabel('Writes', { exact: true })).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Status: Open' })).toHaveCount(
    0
  );
  await expect(page.getByRole('button', { name: 'Status: Done' })).toHaveCount(
    2
  );
});
