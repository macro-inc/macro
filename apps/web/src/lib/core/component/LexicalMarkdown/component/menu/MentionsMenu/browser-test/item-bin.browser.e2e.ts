import { expect, test } from '@playwright/test';

test('filtering away View all keeps the bin header and rows in place', async ({
  page,
}) => {
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/browser-test/item-bin.html'
  );
  const label = page.getByText('People', { exact: true });
  const firstRow = page.getByText('Ada Lovelace', { exact: true });
  await expect(page.getByRole('button', { name: 'View all (5)' })).toBeVisible({
    timeout: 30_000,
  });
  const before = [
    (await label.boundingBox())?.y,
    (await firstRow.boundingBox())?.y,
  ];

  await page.getByLabel('Search people').fill('ada');
  await expect(page.getByRole('button', { name: /View all/ })).toHaveCount(0);

  expect([
    (await label.boundingBox())?.y,
    (await firstRow.boundingBox())?.y,
  ]).toEqual(before);
});
