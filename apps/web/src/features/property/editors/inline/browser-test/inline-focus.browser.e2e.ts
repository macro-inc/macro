import { expect, type Page, test } from '@playwright/test';

async function open(page: Page) {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === 'localhost')
      await route.continue();
    else await route.fulfill({ status: 401, body: '{}' });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(
    '/src/features/property/editors/inline/browser-test/inline-focus.html'
  );
  await expect(page.getByTestId('number')).toBeVisible({ timeout: 60_000 });
}

const field = (page: Page, id: string) =>
  page.getByTestId(id).locator('input, textarea');
const value = (page: Page, id: string) =>
  page.getByTestId(id).locator('button').first();

async function edit(page: Page, id: string) {
  await value(page, id).focus();
  await page.keyboard.press('Enter');
  await expect(field(page, id)).toBeFocused();
}

const finishSave = (page: Page) => page.evaluate(() => window.finishSave());
const failSave = (page: Page) => page.evaluate(() => window.failSave());
const waitForSave = (page: Page) =>
  expect.poll(() => page.evaluate(() => window.heldSaves())).toBe(1);

for (const [id, next] of [
  ['number', '4'],
  ['text', 'Final'],
] as const) {
  test.describe(`${id} value`, () => {
    test.beforeEach(({ page }) => open(page));

    test('Enter hands focus back to the value once it saves', async ({
      page,
    }) => {
      await edit(page, id);
      await field(page, id).fill(next);
      await page.keyboard.press('Enter');
      await waitForSave(page);
      await expect(field(page, id)).toBeFocused();

      await finishSave(page);
      await expect(value(page, id)).toHaveText(next);
      await expect(value(page, id)).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(page.getByTestId(`after-${id}`)).toBeFocused();
    });

    test('Enter on an unchanged value and Escape hand focus back', async ({
      page,
    }) => {
      await edit(page, id);
      await page.keyboard.press('Enter');
      await expect(value(page, id)).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(field(page, id)).toBeFocused();
      await field(page, id).fill(next);
      await page.keyboard.press('Escape');
      await expect(value(page, id)).toBeFocused();
      await expect(value(page, id)).not.toHaveText(next);
    });

    test('a failed save leaves the field focused to try again', async ({
      page,
    }) => {
      await edit(page, id);
      await field(page, id).fill(next);
      await page.keyboard.press('Enter');
      await waitForSave(page);
      await failSave(page);

      await expect(field(page, id)).toBeFocused();
      await expect(field(page, id)).toBeEditable();
      await page.keyboard.press('Enter');
      await waitForSave(page);
      await finishSave(page);
      await expect(value(page, id)).toBeFocused();
    });

    test('Tab while the save runs stays on the next control', async ({
      page,
    }) => {
      await edit(page, id);
      await field(page, id).fill(next);
      await page.keyboard.press('Enter');
      await waitForSave(page);
      await page.keyboard.press('Tab');
      await expect(page.getByTestId(`after-${id}`)).toBeFocused();

      await finishSave(page);
      await expect(value(page, id)).toHaveText(next);
      await expect(page.getByTestId(`after-${id}`)).toBeFocused();
    });

    test('leaving the field by Tab saves without pulling focus back', async ({
      page,
    }) => {
      await edit(page, id);
      await field(page, id).fill(next);
      await page.keyboard.press('Tab');
      await waitForSave(page);
      await finishSave(page);

      await expect(value(page, id)).toHaveText(next);
      await expect(page.getByTestId(`after-${id}`)).toBeFocused();
    });
  });
}

test.describe('link value', () => {
  test.beforeEach(({ page }) => open(page));

  const add = (page: Page, id: string) =>
    page.getByTestId(id).getByRole('button', { name: '+', exact: true });

  test('adding to a list hands focus to the next add button', async ({
    page,
  }) => {
    await add(page, 'links').focus();
    await page.keyboard.press('Enter');
    await expect(field(page, 'links')).toBeFocused();
    await field(page, 'links').fill('example.com/two');
    await page.keyboard.press('Enter');
    await waitForSave(page);
    await expect(field(page, 'links')).toBeFocused();

    await finishSave(page);
    await expect(add(page, 'links')).toBeFocused();
  });

  test('a single link hands focus to its chip', async ({ page }) => {
    await add(page, 'link').focus();
    await page.keyboard.press('Enter');
    await field(page, 'link').fill('example.com/one');
    await page.keyboard.press('Enter');
    await waitForSave(page);
    await finishSave(page);

    await expect(page.getByTestId('link').locator('button')).toBeFocused();
  });

  test('Escape hands focus back to the add button', async ({ page }) => {
    await add(page, 'links').focus();
    await page.keyboard.press('Enter');
    await expect(field(page, 'links')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(add(page, 'links')).toBeFocused();
  });

  test('a failed save leaves the field focused', async ({ page }) => {
    await add(page, 'links').focus();
    await page.keyboard.press('Enter');
    await field(page, 'links').fill('example.com/two');
    await page.keyboard.press('Enter');
    await waitForSave(page);
    await failSave(page);

    await expect(field(page, 'links')).toBeFocused();
    await expect(field(page, 'links')).toBeEditable();
  });
});

test('a checkbox keeps focus through its save', async ({ page }) => {
  await open(page);
  const toggle = value(page, 'flag');
  await toggle.focus();
  await page.keyboard.press('Space');
  await waitForSave(page);
  await expect(toggle).toBeFocused();

  await finishSave(page);
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await waitForSave(page);
  await finishSave(page);
  await expect(toggle).toBeFocused();
});
