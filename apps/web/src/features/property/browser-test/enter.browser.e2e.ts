import { expect, type Locator, type Page, test } from '@playwright/test';

// An open picker blocks pointer events outside it, so a locator click would
// wait forever. A press held like a person's also keeps the pointer down while
// the picker hands focus back.
async function pressOn(page: Page, target: Locator) {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error('Press target missing');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
    { delay: 80 }
  );
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === 'localhost')
      await route.continue();
    else await route.fulfill({ status: 401, body: '{}' });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/src/features/property/browser-test/enter.html');
  await expect(page.getByRole('button', { name: 'In progress' })).toBeVisible({
    timeout: 60_000,
  });
});

test('Enter reopens a picker after a mouse dismisses it, and typing stays there', async ({
  page,
}) => {
  const pill = page.getByRole('button', { name: 'In progress' });
  const search = page.getByLabel('Search options');
  // An open picker hides the page from role queries, so go by label.
  const document = page.getByLabel('Document');

  await pill.click();
  await expect(search).toBeFocused();
  await pressOn(page, page.getByTestId('outside'));
  await expect(search).toBeHidden();
  await expect(pill).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();

  await page.keyboard.type('q');
  await expect(search).toHaveValue('q');
  await expect(document).toHaveText('');
});

test('Tab reaches the pill with no stop on its hover card, and Enter opens it', async ({
  page,
}) => {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'In progress' })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Search options')).toBeFocused();
});

test('a press that takes no focus leaves Enter on the pill', async ({
  page,
}) => {
  await page.keyboard.press('Tab');
  await pressOn(page, page.getByTestId('scrollbar'));
  await expect(page.getByRole('button', { name: 'In progress' })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Search options')).toBeFocused();
});

test('Enter right after clicking a control still moves to the document', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Copy' }).click();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Document' })).toBeFocused();
});
