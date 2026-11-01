import { expect, test } from '@playwright/test';

test('send later is usable without a mouse', async ({ page }) => {
  await page.goto('/?width=520');
  const message = page.getByRole('textbox', { name: 'Message' });
  const summary = page.getByTestId('schedule-summary');
  const search = page.getByRole('combobox');
  const options = page.getByRole('option');
  await message.focus();

  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(search).toBeFocused();
  await expect(options.first()).toContainText('Tomorrow morning');
  await expect(options.first()).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(2)).toContainText('Monday morning');
  await expect(options.nth(2)).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('Enter');
  await expect(summary).toContainText(/Scheduled send: .* at 8:00 AM/);
  await expect(message).toBeFocused();

  await page.keyboard.press('ControlOrMeta+Shift+L');
  await page.keyboard.press('Alt+2');
  await expect(search).toHaveCount(0);
  await expect(summary).toContainText(/Scheduled send: .* at 1:00 PM/);
  await expect(message).toBeFocused();

  // Typed straight after the shortcut, before the menu has finished opening.
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await page.keyboard.type('tom 5');
  await expect(options.nth(0)).toContainText('Tomorrow at 5 PM');
  await expect(options.nth(0)).toHaveAttribute('data-highlighted', '');
  await expect(options.nth(1)).toContainText('Tomorrow at 5 AM');
  await page.keyboard.press('Enter');
  await expect(summary).toContainText(/Scheduled send: .* at 5:00 PM/);
  await expect(message).toHaveValue('Here are the notes we discussed.');

  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(message).toBeFocused();
});
