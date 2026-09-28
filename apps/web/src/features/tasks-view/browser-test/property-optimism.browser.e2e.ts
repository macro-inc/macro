import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // The fixture replaces GraphQL HTTP, and does not need live subscriptions.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.goto(
    '/src/features/tasks-view/browser-test/property-optimism.html'
  );
  await expect(
    page
      .getByRole('region', { name: 'Task 1' })
      .getByRole('button', { name: 'Priority', exact: true })
  ).toBeVisible();
});

test('unset priority updates before HTTP and adopts the server assignment ID', async ({
  page,
}) => {
  const first = page.getByRole('region', { name: 'Task 1' });
  const second = page.getByRole('region', { name: 'Task 2' });
  await first.getByRole('button', { name: 'Priority', exact: true }).click();
  await page
    .locator('[role="menu"]')
    .getByText('Urgent', { exact: true })
    .click();
  await expect(
    first.getByRole('button', { name: 'Urgent', exact: true })
  ).toBeVisible();
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await expect(page.getByText('HTTP requests: 1 · Settled: 0')).toBeVisible();
  await expect(first.locator('output')).toContainText('optimistic-property:');
  await expect(
    second.getByRole('button', { name: 'Priority', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Commit next request' }).click();
  await expect(first.locator('output')).toHaveText(
    '00000000-0000-0000-0000-000000000201'
  );
  await expect(
    first.getByRole('button', { name: 'Urgent', exact: true })
  ).toBeVisible();
});

for (const succeeds of [true, false]) {
  test(`bulk save waits for the queued request's ${succeeds ? 'commit' : 'failure'}`, async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Set both Urgent' }).click();
    await expect(page.getByText('HTTP requests: 1 · Settled: 0')).toBeVisible();
    await page.getByRole('button', { name: 'Commit next request' }).click();
    await expect(page.getByText('HTTP requests: 2 · Settled: 1')).toBeVisible();
    await expect(page.getByLabel('Save status')).toHaveText(
      'Pending: yes · Succeeded: 0 · Failed: 0'
    );
    await page
      .getByRole('button', {
        name: succeeds ? 'Commit next request' : 'Fail next request',
      })
      .click();
    await expect(page.getByLabel('Save status')).toHaveText(
      succeeds
        ? 'Pending: no · Succeeded: 1 · Failed: 0'
        : 'Pending: no · Succeeded: 0 · Failed: 1'
    );
    await expect(
      page.getByRole('region', { name: 'Task 2' }).getByRole('button', {
        name: succeeds ? 'Urgent' : 'Priority',
        exact: true,
      })
    ).toBeVisible();
  });
}

test('bulk layers appear before the first response and rollback stays task-scoped', async ({
  page,
}) => {
  const first = page.getByRole('region', { name: 'Task 1' });
  const second = page.getByRole('region', { name: 'Task 2' });
  await page.getByRole('button', { name: 'Set both Urgent' }).click();
  await expect(
    first.getByRole('button', { name: 'Urgent', exact: true })
  ).toBeVisible();
  await expect(
    second.getByRole('button', { name: 'Urgent', exact: true })
  ).toBeVisible();
  await expect(page.getByText('HTTP requests: 1 · Settled: 0')).toBeVisible();
  expect(await first.locator('output').textContent()).not.toBe(
    await second.locator('output').textContent()
  );
  await page.getByRole('button', { name: 'Fail next request' }).click();
  await expect(
    first.getByRole('button', { name: 'Priority', exact: true })
  ).toBeVisible();
  await expect(
    second.getByRole('button', { name: 'Urgent', exact: true })
  ).toBeVisible();
  await expect(page.getByText('HTTP requests: 2 · Settled: 1')).toBeVisible();
  await expect(page.getByLabel('Save status')).toHaveText(
    'Pending: yes · Succeeded: 0 · Failed: 0'
  );
  await page.getByRole('button', { name: 'Commit next request' }).click();
  await expect(second.locator('output')).toHaveText(
    '00000000-0000-0000-0000-000000000202'
  );
  await expect(page.getByLabel('Save status')).toHaveText(
    'Pending: no · Succeeded: 0 · Failed: 1'
  );
  await expect(
    second.getByRole('button', { name: 'Urgent', exact: true })
  ).toBeVisible();
});
