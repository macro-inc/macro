import { expect, test } from '@playwright/test';

const person = 'macro|person@example.com';
test.beforeEach(async ({ page }) => {
  await page.route('https://**', (route) => route.abort());
  await page.route('**/jwt/macro_api_token', (route) =>
    route.fulfill({
      json: {
        macro_api_token: `fixture.${btoa(JSON.stringify({ exp: 4102444800 }))}.fixture`,
      },
    })
  );
});

test('labels and participant names share bounded requests and active labels survive 100k idle reads', async ({
  page,
}) => {
  const batches: string[][] = [];
  await page.route('**/user/get_names_with_email', async (route) => {
    const ids: string[] = route.request().postDataJSON().user_ids;
    batches.push(ids);
    await route.fulfill({
      json: {
        names: ids.map((id) => ({
          id,
          first_name: id === person ? 'Active label' : 'Idle label',
        })),
      },
    });
  });
  await page.goto('/?name-cache');
  await expect(page.getByTestId('name-label')).toContainText('Active label', {
    timeout: 20000,
  });
  await expect(page.getByTestId('participant-names')).toHaveText(
    'Active label'
  );
  expect(batches).toEqual([[person]]);
  await page.getByRole('button', { name: 'Browse 100k' }).click();
  await expect(page.getByTestId('name-label')).toContainText('Active label');
  await page.getByRole('button', { name: 'Inspect cache' }).click();
  const stats = JSON.parse(
    await page.getByTestId('name-cache-stats').innerText()
  );
  expect(stats.idle).toBeLessThanOrEqual(512);
  expect(stats.idleBytes).toBeLessThanOrEqual(512 * 1024);
  expect(stats.pending).toBeLessThanOrEqual(500);
  expect(stats.inFlight).toBeLessThanOrEqual(500);
  expect(stats.active).toBe(1);
  expect(batches.every((ids) => ids.length <= 500)).toBe(true);
  expect(batches.filter((ids) => ids.includes(person))).toHaveLength(1);
  await page.getByRole('button', { name: 'Recycle label' }).click();
  await expect(page.getByTestId('name-label')).toContainText('Idle label');
  await page.getByRole('button', { name: 'Hide labels' }).click();
  await expect(page.getByTestId('name-label')).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect cache' }).click();
  expect(
    JSON.parse(await page.getByTestId('name-cache-stats').innerText()).active
  ).toBe(0);
});

test('returning accounts cannot revive delayed names or captured overrides', async ({
  page,
}) => {
  let owner = 'First';
  let calls = 0;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const lateFinished = Promise.withResolvers<void>();
  await page.route('**/user/get_names_with_email', async (route) => {
    const label = owner;
    const ids: string[] = route.request().postDataJSON().user_ids;
    const late = ++calls === 2;
    if (late) {
      entered.resolve();
      await release.promise;
    }
    try {
      await route.fulfill({
        json: { names: ids.map((id) => ({ id, first_name: label })) },
      });
    } catch (error) {
      if (!late) throw error;
    } finally {
      if (late) lateFinished.resolve();
    }
  });
  try {
    await page.goto('/?name-cache');
    await expect(page.getByTestId('name-label')).toContainText('First', {
      timeout: 20000,
    });
    owner = 'Stale response';
    await page.getByRole('button', { name: 'Refresh captured name' }).click();
    await entered.promise;
    owner = 'Second account';
    await page.getByRole('button', { name: 'Account B', exact: true }).click();
    await expect(page.getByTestId('name-label')).not.toContainText('First');
    await expect(page.getByTestId('name-label')).not.toContainText(
      'Stale response'
    );
    owner = 'Returned account';
    await page.getByRole('button', { name: 'Account A', exact: true }).click();
    await page.getByRole('button', { name: 'Old override' }).click();
    await expect(page.getByTestId('name-label')).not.toContainText(
      'Stale override'
    );
    await expect(page.getByTestId('name-label')).toContainText(
      'Returned account'
    );
    release.resolve();
    await lateFinished.promise;
    await expect(page.getByTestId('name-label')).toContainText(
      'Returned account'
    );
    await expect(page.getByTestId('participant-names')).toHaveText(
      'Returned account'
    );
    expect(calls).toBeLessThanOrEqual(4);
  } finally {
    release.resolve();
  }
});

test('authorization refusal clears private labels and a replacement session can load again', async ({
  page,
}) => {
  let deny = false;
  let calls = 0;
  await page.route('**/user/get_names_with_email', async (route) => {
    calls++;
    if (deny) {
      await route.fulfill({ status: 403, json: { message: 'Forbidden' } });
      return;
    }
    const ids: string[] = route.request().postDataJSON().user_ids;
    await route.fulfill({
      json: { names: ids.map((id) => ({ id, first_name: 'Private label' })) },
    });
  });
  await page.goto('/?name-cache');
  await expect(page.getByTestId('name-label')).toContainText('Private label', {
    timeout: 20000,
  });
  deny = true;
  await page.getByRole('button', { name: 'Refresh captured name' }).click();
  await expect(page.getByTestId('name-label')).toContainText(
    'person@example.com'
  );
  await expect(page.getByTestId('participant-names')).toHaveText('Unknown');
  await page.getByRole('button', { name: 'Refresh captured name' }).click();
  expect(calls).toBe(2);
  deny = false;
  await page.getByRole('button', { name: 'Replace session' }).click();
  await expect(page.getByTestId('name-label')).toContainText('Private label');
  expect(calls).toBe(3);
});
