import { expect, test } from '@playwright/test';
import { openFixture } from './open-fixture';

test('Enter continues down the column and creates successive records from the blank row', async ({
  page,
}) => {
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html'
  );
  await page.getByRole('button', { name: /^Name: First record\./ }).click();
  const editor = page.getByRole('textbox', { name: 'Edit Name' });
  await editor.fill('Updated first');
  await editor.press('Enter');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('');
  await expect(page.getByLabel('Stored name')).toHaveText('Updated first');
  await editor.fill('Second record');
  await editor.press('Enter');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('');
  await expect(
    page.getByRole('button', { name: /^Name: Second record\./ })
  ).toBeVisible();
  await editor.fill('Third record');
  await editor.press('Enter');
  await expect(editor).toHaveValue('');
  await expect(
    page.getByRole('button', { name: /^Name: Third record\./ })
  ).toBeVisible();
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((element) => ({
      border: getComputedStyle(element).borderWidth,
      shadow: getComputedStyle(element).boxShadow,
    }))
  ).toEqual({ border: '0px', shadow: 'none' });
  await editor.press('Shift+Enter');
  await expect(editor).toHaveValue('Third record');
  await editor.press('Enter');
  await expect(editor).toHaveValue('');
  await editor.press('Enter');
  await expect(page.locator('[data-grid-row-id]')).toHaveCount(4);
});

test('edits embedded records without entity metadata or schema controls', async ({
  page,
}) => {
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html'
  );
  const grid = page.getByRole('grid', { name: 'Embedded records' });
  await expect(grid).toBeVisible();
  await expect(grid).toHaveAttribute('aria-colcount', '2');
  await expect(page.getByRole('columnheader')).toHaveCount(2);
  await page.getByRole('button', { name: /^Name: First record\./ }).dblclick();
  const input = page.getByRole('textbox', { name: 'Edit Name' });
  await input.fill('Updated record');
  await input.press('Tab');
  await expect(page.getByLabel('Stored name')).toHaveText('Updated record');
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await page
    .getByRole('button', { name: 'Name: Updated record', exact: true })
    .dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit Name' })).toHaveCount(0);
  await expect(page.getByLabel('Stored name')).toHaveText('Updated record');
});
