import { expect, test } from '@playwright/test';

test('partial local recipients keep reversed-word matches and reject arbitrary gaps without server search', async ({
  page,
}) => {
  await page.goto('/?sql-people&policy');
  await expect(page.getByTestId('policy-ready')).toHaveText('ready', {
    timeout: 20000,
  });
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('graphql-contacts-backfill:v2:'))
        localStorage.removeItem(key);
    }
  });
  const remoteSearches: string[] = [];
  page.on('request', (request) => {
    if (request.postData()?.includes('ContactDirectoryPage'))
      remoteSearches.push(request.url());
  });
  const input = page.getByRole('combobox');
  await page
    .getByRole('button', { name: 'Update recency', exact: true })
    .click();
  await input.fill('50 per');
  await expect(page.getByRole('option').first()).toContainText('Person 50');
  await input.press('Enter');
  await expect(page.getByTestId('policy-selections')).toHaveText(
    '["macro|outside@example.com","macro|person50@example.com"]'
  );
  await input.fill('prsn');
  await expect(
    page.getByText('No matches in this page or cached snapshot.')
  ).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
  await input.fill('person50@example.com');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Person 50');
  expect(remoteSearches).toEqual([]);
});
