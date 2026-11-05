import { expect, test } from '@playwright/test';

test('real cached command windows apply inbox exclusions and DM dedup before limiting, including offline continuations', async ({
  page,
  context,
}) => {
  await page.goto('/?sql-people&policy');
  await expect(page.getByTestId('policy-ready')).toHaveText('ready', {
    timeout: 20000,
  });
  await context.setOffline(true);
  await page
    .getByRole('button', { name: 'Read command people', exact: true })
    .click();
  await expect(page.getByTestId('command-count')).toHaveText('50');
  await expect(page.getByTestId('command-source')).toHaveText('cache');
  await expect(page.getByTestId('command-dm-count')).toHaveText('1');
  await expect(page.getByTestId('command-ids')).not.toContainText(
    'macro|person3@example.com'
  );
  await expect(page.getByTestId('command-ids')).not.toContainText(
    'macro|not-member@example.com'
  );
  const first = await page.getByTestId('command-ids').textContent();
  await page
    .getByRole('button', { name: 'Next command people', exact: true })
    .click();
  await expect(page.getByTestId('command-ids')).not.toHaveText(first ?? '');
  await expect(page.getByTestId('command-count')).toHaveText('50');
  await expect(page.getByTestId('command-dm-count')).toHaveText('0');
  await expect(page.getByTestId('command-source')).toHaveText('cache');
});

test('real cached recipients preserve custom selections and react to published DM activity', async ({
  page,
  context,
}) => {
  await page.goto('/?sql-people&policy');
  await expect(page.getByTestId('policy-ready')).toHaveText('ready', {
    timeout: 20000,
  });
  await context.setOffline(true);
  const input = page.getByRole('combobox');
  await input.fill('person');
  await expect(page.getByRole('option').first()).toContainText('Person 4');
  await input.press('Enter');
  await expect(page.getByTestId('policy-selections')).toHaveText(
    '["macro|outside@example.com","macro|person4@example.com"]'
  );
  await page
    .getByRole('button', { name: 'Update recency', exact: true })
    .click();
  await input.fill('person');
  await expect(page.getByRole('option').first()).toContainText('Person 5');
  await expect(
    page.getByRole('option', { name: /person3@example.com/ })
  ).toHaveCount(0);
  await input.press('Enter');
  await expect(page.getByTestId('policy-selections')).toHaveText(
    '["macro|outside@example.com","macro|person4@example.com","macro|person5@example.com"]'
  );
});
