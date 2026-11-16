import { expect, test } from '@playwright/test';

test('executes people SQL in real local Turso, including a fresh query offline', async ({
  page,
  context,
}) => {
  const forbidden: string[] = [];
  await page.route('**/databases/{read,query}', async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.goto('/?sql-people');
  await expect(page.getByTestId('sql-result')).toContainText('1001', {
    timeout: 20000,
  });
  await expect(page.getByTestId('sql-cached')).toHaveText('true');
  await expect(page.getByTestId('sql-native-reads')).toHaveText('1');
  await context.setOffline(true);
  await page
    .getByRole('textbox', { name: 'SQL', exact: true })
    .fill(
      "SELECT name FROM macro.people WHERE email = 'late@example.com' LIMIT 1"
    );
  await expect(page.getByTestId('sql-result')).toContainText(
    'Late private name'
  );
  await page
    .getByRole('textbox', { name: 'SQL', exact: true })
    .fill('SELECT COUNT(*) AS total FROM macro.people');
  await expect(page.getByTestId('sql-result')).toContainText('1001');
  const reads = await page.getByTestId('sql-native-reads').textContent();
  await page
    .getByRole('textbox', { name: 'SQL', exact: true })
    .fill("DELETE FROM macro.people WHERE id = 'macro|late@example.com'");
  await expect(page.getByRole('alert')).not.toBeEmpty();
  await expect(page.getByTestId('sql-native-reads')).toHaveText(reads ?? '');
  expect(forbidden).toEqual([]);
});

test('missing local capability is explicit and cannot become a remote fallback', async ({
  page,
}) => {
  const forbidden: string[] = [];
  await page.route('**/databases/{read,query}', async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.goto('/?sql-people');
  await expect(page.getByTestId('sql-result')).toContainText('1001', {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Disable local SQL' }).click();
  await expect(page.getByRole('alert')).toHaveText('rejected');
  await expect(page.getByTestId('sql-result')).toBeEmpty();
  expect(forbidden).toEqual([]);
});

test('replacement login clears old results and waits for obsolete physical work to finish', async ({
  page,
}) => {
  await page.goto('/?sql-people');
  await expect(page.getByTestId('sql-result')).toContainText('1001', {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Hold next read' }).click();
  await page.getByRole('button', { name: 'Refresh read' }).click();
  await expect(page.getByTestId('sql-held')).toHaveText('true');
  await expect(page.getByTestId('sql-native-reads')).toHaveText('2');
  await page.getByRole('button', { name: 'Replace login' }).click();
  await expect(page.getByTestId('sql-result')).toBeEmpty();
  await expect(page.getByTestId('sql-native-reads')).toHaveText('2');
  await page.getByRole('button', { name: 'Release read' }).click();
  await expect(page.getByTestId('sql-result')).toContainText('1001');
  await expect(page.getByTestId('sql-native-reads')).toHaveText('3');
  await expect(page.getByRole('alert')).toBeEmpty();
});
