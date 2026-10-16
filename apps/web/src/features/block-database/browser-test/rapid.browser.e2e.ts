import { expect, test } from '@playwright/test';
import { openFixture } from './open-fixture';

test('Enter moves down immediately before any pending save completes', async ({
  page,
}) => {
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html?rapid&holdWrites'
  );
  await page.getByRole('button', { name: /^Name: First record\./ }).click();
  await page.keyboard.type('Saved first');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Edit Name' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('');
  expect(
    await editor.evaluate((element) => {
      const selection = document.getSelection();
      return selection?.isCollapsed && element.contains(selection.anchorNode);
    })
  ).toBe(true);
  await expect(page.getByLabel('Stored name')).toHaveText('First record');
  await page.keyboard.type('Saved second');
  await page.keyboard.press('Enter');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('');
  await page.keyboard.press('Shift+Enter');
  await expect(editor).toHaveText('Saved second');
  expect(
    await editor.evaluate((element) => {
      const selection = document.getSelection();
      return (
        selection?.isCollapsed &&
        element.contains(selection.anchorNode) &&
        selection.anchorOffset === 'Saved second'.length
      );
    })
  ).toBe(true);
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  expect(
    JSON.parse(await page.getByLabel('Stored records').innerText())
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'Release saves' }).click();
  await expect
    .poll(async () =>
      JSON.parse(await page.getByLabel('Stored records').innerText()).map(
        (row: { cells: Record<string, string> }) => row.cells.name
      )
    )
    .toEqual(['Saved first', 'Saved second!']);
});

test('a column inference response keeps the current draft focused and Tab saves into the same column', async ({
  page,
}) => {
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html?rapid'
  );
  await page
    .getByRole('button', { name: 'notes: Empty. Click to edit' })
    .first()
    .click();
  const editor = page.getByRole('textbox', { name: 'Edit notes' });
  await page.keyboard.type('456');
  const original = await editor.elementHandle();
  await page.getByRole('button', { name: 'Infer numbers' }).click();
  expect(
    await editor.evaluate((element, original) => element === original, original)
  ).toBe(true);
  await expect(editor).toBeFocused();
  await page.keyboard.type('7');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('textbox', { name: 'Edit detail' })
  ).toBeFocused();
  await page.keyboard.type('Next column');
  await page.keyboard.press('Tab');
  await expect
    .poll(
      async () =>
        JSON.parse(await page.getByLabel('Stored records').innerText())[0].cells
    )
    .toEqual({ name: 'First record', notes: 4567, detail: 'Next column' });
});

test('rapid typing and Tab keep values in their own cells while row saves arrive', async ({
  page,
}) => {
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html?rapid'
  );
  await page.getByRole('button', { name: /^Name: First record\./ }).click();
  const expected = Array.from({ length: 6 }, (_, index) => ({
    name: `name-${index}`,
    notes: `notes-${index}`,
    detail: `detail-${index}`,
  }));
  for (const row of expected) {
    for (const value of Object.values(row)) {
      await page.keyboard.type(value);
      await page.keyboard.press('Tab');
    }
  }
  await expect
    .poll(async () =>
      JSON.parse(await page.getByLabel('Stored records').innerText()).map(
        (row: { cells: Record<string, string> }) => row.cells
      )
    )
    .toEqual(expected);
  await expect(page.getByRole('textbox', { name: 'Edit Name' })).toBeFocused();
});
