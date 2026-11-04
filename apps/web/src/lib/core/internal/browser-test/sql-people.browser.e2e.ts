import { expect, test } from '@playwright/test';

const viewer = 'macro|viewer@example.com';
function response(sql: string, viewerId = viewer) {
  const count = sql.includes('COUNT(*)');
  return {
    viewerId,
    outcome: {
      statement: { kind: 'select' },
      tableDatabases: {},
      changesApplied: 0,
      insertedRowIds: [],
      newVersions: {},
      readVersions: {},
      truncatedTables: [],
      result: {
        columns: count
          ? [{ name: 'total', kind: 'number' }]
          : [
              {
                name: 'name',
                kind: 'text',
                definitionId: '6d616372-6f00-0000-0000-000070656f72',
              },
            ],
        rows: [
          [
            count
              ? { type: 'number', value: 100001 }
              : { type: 'text', value: 'Late private name' },
          ],
        ],
        rowIds: [],
      },
    },
  };
}

test('real SQL compiler routes people statements to read-only HTTP without browser contact reads', async ({
  page,
}) => {
  const requests: string[] = [];
  const forbidden: string[] = [];
  await page.route('**/databases/read', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body.sql);
    await route.fulfill({ json: response(body.sql) });
  });
  await page.route('**/databases/query', async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.goto('/?sql-people');
  await expect(page.getByTestId('sql-result')).toContainText('100001');
  await expect(page.getByTestId('sql-cached')).toHaveText('false');
  expect(requests).toEqual(['SELECT COUNT(*) AS total FROM macro.people']);
  await page
    .getByRole('textbox', { name: 'SQL', exact: true })
    .fill(
      "SELECT name FROM macro.people WHERE email = 'late@example.com' LIMIT 1"
    );
  await expect(page.getByTestId('sql-result')).toContainText(
    'Late private name'
  );
  expect(requests).toHaveLength(2);
  await page
    .getByRole('textbox', { name: 'SQL', exact: true })
    .fill("DELETE FROM macro.people WHERE id = 'macro|late@example.com'");
  await expect(page.getByRole('alert')).not.toBeEmpty();
  expect(requests).toHaveLength(2);
  expect(forbidden).toEqual([]);
});

test('missing read capability is an error, not a full-list or read/write fallback', async ({
  page,
}) => {
  let readWrite = 0;
  await page.route('**/databases/read', (route) =>
    route.fulfill({ status: 404, json: { message: 'Read route unavailable' } })
  );
  await page.route('**/databases/query', async (route) => {
    readWrite++;
    await route.abort();
  });
  await page.goto('/?sql-people');
  await expect(page.getByRole('alert')).toHaveText('rejected');
  await expect(page.getByTestId('sql-result')).toBeEmpty();
  expect(readWrite).toBe(0);
});

test('foreign-viewer responses are rejected even before local identity refresh', async ({
  page,
}) => {
  await page.route('**/databases/read', (route) =>
    route.fulfill({
      json: response(
        route.request().postDataJSON().sql,
        'macro|other@example.com'
      ),
    })
  );
  await page.goto('/?sql-people');
  await expect(page.getByRole('alert')).toHaveText('scope-changed');
  await expect(page.getByTestId('sql-result')).toBeEmpty();
});

test('replacement login clears the old answer and aborts an in-flight response', async ({
  page,
}) => {
  const held = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let requests = 0;
  await page.route('**/databases/read', async (route) => {
    requests++;
    if (requests === 2) {
      entered.resolve();
      await held.promise;
      // The client cancels this request when its account session changes.
      try {
        await route.fulfill({
          json: response(route.request().postDataJSON().sql),
        });
      } catch {
        /* canceled request */
      }
      return;
    }
    await route.fulfill({ json: response(route.request().postDataJSON().sql) });
  });
  try {
    await page.goto('/?sql-people');
    await expect(page.getByTestId('sql-result')).toContainText('100001');
    await page.getByRole('button', { name: 'Refresh read' }).click();
    await entered.promise;
    await page.getByRole('button', { name: 'Replace login' }).click();
    await expect(page.getByTestId('sql-loading')).toHaveText('false');
    expect(requests).toBe(3);
    held.resolve();
    await expect(page.getByTestId('sql-result')).toContainText('100001');
    await expect(page.getByRole('alert')).toBeEmpty();
  } finally {
    held.resolve();
  }
});
