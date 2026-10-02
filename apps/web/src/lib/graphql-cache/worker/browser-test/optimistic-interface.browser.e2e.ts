import { expect, test } from '@playwright/test';

const first = '[data-row="00000000-0000-0000-0000-000000000001"]';

test.beforeEach(async ({ page }) => {
  await page.goto('/optimistic-interface.html');
  await expect(page.locator('[data-row]')).toHaveCount(1000, {
    timeout: 60_000,
  });
});

test('only changed fields react before the network resolves; commit keeps all row identities', async ({
  page,
}) => {
  await page.locator('#seen').click();
  await expect(page.locator(`${first} [data-field="read"]`)).toHaveText('true');
  const optimistic = await page.evaluate(() =>
    window.optimisticInterface.snapshot()
  );
  expect(optimistic.counts).toEqual({
    mounts: 1000,
    name: 1000,
    isRead: 1001,
    inboxVisible: 1000,
  });
  expect(optimistic.last).toEqual({ name: 1, isRead: 1, inboxVisible: 1 });
  expect(optimistic.results).toEqual(['pending']);
  expect(optimistic.errors).toEqual([]);
  await page.evaluate(() => window.optimisticInterface.reply(0));
  await expect
    .poll(() =>
      page.evaluate(() => window.optimisticInterface.snapshot().results)
    )
    .toEqual(['committed']);
  expect(
    (await page.evaluate(() => window.optimisticInterface.snapshot())).counts
  ).toEqual(optimistic.counts);
});

test('a permanent failure rolls back without remounting or resetting unrelated fields', async ({
  page,
}) => {
  await page.locator('#archive').click();
  await expect(page.locator(`${first} [data-field="inbox"]`)).toHaveText(
    'false'
  );
  await page.evaluate(() => window.optimisticInterface.reply(0, 'permanent'));
  await expect(page.locator(`${first} [data-field="inbox"]`)).toHaveText(
    'true'
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.optimisticInterface.snapshot().results)
    )
    .toEqual(['failed']);
  expect(
    (await page.evaluate(() => window.optimisticInterface.snapshot())).counts
  ).toEqual({ mounts: 1000, name: 1000, isRead: 1000, inboxVisible: 1002 });
});

test('a later intent survives an older rollback and a stale server refresh', async ({
  page,
}) => {
  await page.locator('#seen').click();
  await expect(page.locator(`${first} [data-field="read"]`)).toHaveText('true');
  await page.locator('#unread').click();
  await expect(page.locator(`${first} [data-field="read"]`)).toHaveText(
    'false'
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.optimisticInterface.snapshot().results)
    )
    .toEqual(['pending', 'queued']);
  await page.evaluate(() => window.optimisticInterface.repaint());
  await expect(page.locator(`${first} [data-field="read"]`)).toHaveText(
    'false'
  );
  await page.evaluate(() => window.optimisticInterface.reply(0, 'permanent'));
  await expect
    .poll(() =>
      page.evaluate(() => window.optimisticInterface.snapshot().network)
    )
    .toBe(2);
  await expect(page.locator(`${first} [data-field="read"]`)).toHaveText(
    'false'
  );
  await page.evaluate(() => window.optimisticInterface.reply(1));
  expect(
    (await page.evaluate(() => window.optimisticInterface.snapshot())).errors
  ).toEqual([]);
});

test('retryable network errors retain optimism and return queued', async ({
  page,
}) => {
  await page.locator('#archive').click();
  await expect(page.locator(`${first} [data-field="inbox"]`)).toHaveText(
    'false'
  );
  await page.evaluate(() => window.optimisticInterface.reply(0, 'retryable'));
  await expect
    .poll(() =>
      page.evaluate(() => window.optimisticInterface.snapshot().results)
    )
    .toEqual(['queued']);
  await page.evaluate(() => window.optimisticInterface.repaint());
  await expect(page.locator(`${first} [data-field="inbox"]`)).toHaveText(
    'false'
  );
});

test('the authoritative response can correct the predicted field', async ({
  page,
}) => {
  await page.locator('#seen').click();
  await expect(page.locator(`${first} [data-field="read"]`)).toHaveText('true');
  await page.evaluate(() =>
    window.optimisticInterface.reply(0, undefined, {
      markEmailThreadSeen: {
        __typename: 'GraphqlSoupEmailThread',
        id: '00000000-0000-0000-0000-000000000001',
        isRead: false,
      },
    })
  );
  await expect(page.locator(`${first} [data-field="read"]`)).toHaveText(
    'false'
  );
  expect(
    (await page.evaluate(() => window.optimisticInterface.snapshot())).counts
      .mounts
  ).toBe(1000);
});
