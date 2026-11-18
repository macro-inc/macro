import { expect, test } from '@playwright/test';

test('a failed first proof shows the existing retry state and recovers locally', async ({
  page,
}) => {
  let available = false;
  await page.route('**/fixture-authority', (route) =>
    route.fulfill({
      status: available ? 200 : 503,
      headers: available
        ? {
            'x-macro-crm-access':
              '00000000-0000-7000-8000-000000000001:allowed',
          }
        : {},
      body: '{}',
    })
  );
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading…' })).toHaveCount(0);
  await expect(page.getByText("You don't have access to CRM")).toHaveCount(0);
  available = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Private record content')).toBeVisible();
});

test('revokes open tabs, retains an individual pipeline, denies record navigation and restores access', async ({
  context,
  page,
}, info) => {
  let allowed = true;
  await context.route('**/fixture-authority', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'x-macro-crm-access': `00000000-0000-7000-8000-000000000001:${allowed ? 'allowed' : 'denied'}`,
      },
      body: '{}',
    })
  );
  await context.route('https://**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('Private record content')).toBeVisible();
  const pipeline = await context.newPage();
  await pipeline.goto('/?view=pipeline');
  await expect(
    pipeline.getByRole('heading', { name: 'Shared pipeline' })
  ).toBeVisible();
  allowed = false;
  await page.getByRole('button', { name: 'Check access', exact: true }).click();
  await pipeline
    .getByRole('button', { name: 'Check access', exact: true })
    .click();
  await expect(page.getByText("You don't have access to CRM")).toBeVisible();
  await expect(page.getByText('Private record content')).toHaveCount(0);
  const directory = process.env.CRM_ACCESS_SCREENSHOTS;
  if (directory)
    await page.screenshot({
      path: `${directory}/records-denied-navigation-${info.project.name}.png`,
      fullPage: true,
    });
  const navigation =
    info.project.name === 'phone'
      ? page.getByRole('navigation', { name: 'CRM views' })
      : page.locator('aside');
  await navigation
    .getByRole('button', { name: 'Shared pipeline', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Shared pipeline' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open records route' }).click();
  await expect(page.getByText("You don't have access to CRM")).toBeVisible();
  await expect(pipeline.getByText('Private collection')).toHaveCount(0);
  await expect(
    pipeline.getByRole('heading', { name: 'Shared pipeline' })
  ).toBeVisible();
  if (directory)
    await pipeline.screenshot({
      path: `${directory}/shared-pipeline-${info.project.name}.png`,
      fullPage: true,
    });
  await pipeline
    .getByRole('button', { name: 'Open referenced record' })
    .click();
  await expect(
    pipeline.getByText("You don't have access to CRM")
  ).toBeVisible();
  if (directory)
    await pipeline.screenshot({
      path: `${directory}/record-denied-${info.project.name}.png`,
      fullPage: true,
    });
  const recordNavigation =
    info.project.name === 'phone'
      ? pipeline.getByRole('navigation', { name: 'CRM views' })
      : pipeline.locator('aside');
  await expect(
    recordNavigation.getByRole('button', { name: 'Companies', exact: true })
  ).toHaveCount(0);
  await expect(
    recordNavigation.getByRole('button', {
      name: 'Private collection',
      exact: true,
    })
  ).toHaveCount(0);
  await recordNavigation
    .getByRole('button', { name: 'Shared pipeline', exact: true })
    .click();
  await expect(
    pipeline.getByRole('heading', { name: 'Shared pipeline' })
  ).toBeVisible();
  await pipeline
    .getByRole('button', { name: 'Open referenced record' })
    .click();
  await expect(
    pipeline.getByText("You don't have access to CRM")
  ).toBeVisible();
  allowed = true;
  await page.getByRole('button', { name: 'Check access', exact: true }).click();
  await pipeline
    .getByRole('button', { name: 'Check access', exact: true })
    .click();
  await expect(page.getByText('Private record content')).toBeVisible();
  await expect(pipeline.getByText('Private record content')).toBeVisible();
  for (const current of [page, pipeline]) {
    expect(
      await current.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
});

test('a cold deep link waits for proof and an allowed view survives a transient outage', async ({
  page,
}) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let offline = false;
  let proofs = 0;
  await page.route('**/fixture-authority', async (route) => {
    proofs++;
    await ready;
    if (offline) return route.abort();
    await route.fulfill({
      status: 200,
      headers: {
        'x-macro-crm-access': '00000000-0000-7000-8000-000000000001:allowed',
      },
      body: '{}',
    });
  });
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Loading…' })).toBeVisible();
  await expect(page.getByText("You don't have access to CRM")).toHaveCount(0);
  release();
  await expect(page.getByText('Private record content')).toBeVisible();
  offline = true;
  await page.getByRole('button', { name: 'Check access', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Access could not be refreshed'
  );
  await expect(page.getByText('Private record content')).toBeVisible();
  await expect(page.getByText("You don't have access to CRM")).toHaveCount(0);
  expect(proofs).toBe(3); // Boot plus one bounded retry of the explicit refresh.
});
