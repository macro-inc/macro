import { expect, type Locator, type Page, test } from '@playwright/test';

/** Corvu starts the opening slide a frame after mount, so wait for it to end. */
async function settled(sheet: Locator) {
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).not.toHaveAttribute('data-transitioning');
}

const ringed = (target: Locator) =>
  target.evaluate((element) => element.matches(':focus-visible'));

const focusedLabel = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent ??
      null
  );

test('a sheet of rows opens with focus on itself, with no ring on its first row', async ({
  page,
}) => {
  await page.goto('/?scenario=menu');
  const sheet = page.getByRole('dialog', { name: 'Add to message' });
  await settled(sheet);

  await expect(sheet).toBeFocused();
  expect(await focusedLabel(page)).toBe('Add to message');
  const first = sheet.getByRole('button', { name: 'Mention' });
  await expect(first).not.toBeFocused();
  expect(await ringed(first)).toBe(false);
  // The sheet holds focus, and a focused sheet shows nothing of its own.
  await expect(sheet).toHaveCSS('outline-style', 'none');
});

test('a keyboard still reaches every row of a sheet and wraps around it', async ({
  page,
}) => {
  await page.goto('/?scenario=menu');
  const sheet = page.getByRole('dialog', { name: 'Add to message' });
  await settled(sheet);

  await page.keyboard.press('Tab');
  const first = sheet.getByRole('button', { name: 'Mention' });
  await expect(first).toBeFocused();
  expect(await ringed(first)).toBe(true);

  // Shift+Tab with the sheet itself focused must stay inside it rather than
  // reach the page the scrim covers.
  await sheet.evaluate((element: HTMLElement) => element.focus());
  await page.keyboard.press('Shift+Tab');
  await expect(sheet.getByRole('button', { name: 'New poll' })).toBeFocused();
});

test('a sheet opened to type in focuses the field, with no ring to show', async ({
  page,
}) => {
  await page.goto('/?scenario=typing');
  const sheet = page.getByRole('dialog', { name: 'Choose a repository' });
  await settled(sheet);

  const search = sheet.getByRole('textbox', { name: 'Search repositories' });
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS('outline-style', 'none');
});

test('a sheet that names its initial focus still gets it', async ({ page }) => {
  await page.goto('/?scenario=search');
  const sheet = page.getByRole('dialog', { name: 'Choose a model' });
  await settled(sheet);

  await expect(
    sheet.getByRole('textbox', { name: 'Search models' })
  ).toBeFocused();
});
