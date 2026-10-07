import { expect, test } from '@playwright/test';

test('typing right after the sheet loads edits the highlighted cell', async ({
  page,
}) => {
  await page.goto('/?load=500');
  await expect(page.getByRole('grid', { name: 'Spreadsheet' })).toBeFocused();
  await page.keyboard.type('month');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-address="A1"]')).toHaveText('month');
  await expect(page.getByRole('textbox', { name: 'Go to cell' })).toHaveValue(
    'A2'
  );
});

test('loading does not take focus from a control the user already reached', async ({
  page,
}) => {
  await page.goto('/?load=1500');
  const address = page.getByRole('textbox', { name: 'Go to cell' });
  await address.focus();
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await expect(address).toBeFocused();
});
