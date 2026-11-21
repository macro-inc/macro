import { expect, test } from '@playwright/test';

test('long model names wrap inside their own rows in search results', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Model' }).click();
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('open');
  const label = page.getByText('9 matching models');
  await expect(label).toBeVisible();
  // The group label keeps its full height (h-7) under the same squeeze.
  const labelHeight = await label.evaluate(
    (element) => element.getBoundingClientRect().height
  );
  expect(labelHeight).toBeGreaterThanOrEqual(28);

  const rows = page.getByRole('menuitem');
  const count = await rows.count();
  expect(count).toBe(9);
  for (let index = 0; index < count; index++) {
    const row = rows.nth(index);
    // A row as tall as its wrapped label: nothing spills into the next one.
    const fits = await row.evaluate(
      (element) => element.scrollHeight <= element.clientHeight
    );
    expect(fits, `row ${index} clips its label`).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('search-results.png') });
});
