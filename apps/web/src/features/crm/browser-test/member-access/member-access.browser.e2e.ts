import { expect, type Page, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('https://**', (route) => route.abort());
  await context.routeWebSocket('**/*', (socket) => socket.close());
});

async function openFixture(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('record-mounts')).toBeAttached({
    timeout: 30_000,
  });
}

test('a failed first proof shows the existing retry state and recovers locally', async ({
  page,
}, info) => {
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
  await openFixture(page, '/');
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading…' })).toHaveCount(0);
  await expect(page.getByText("You don't have access to CRM")).toHaveCount(0);
  const navigation =
    info.project.name === 'phone'
      ? page.getByRole('navigation', { name: 'CRM views' })
      : page.locator('aside[data-view-sidebar]');
  await expect(
    navigation.getByRole('button', { name: 'People', exact: true })
  ).toBeVisible();
  available = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Private record content')).toBeVisible();
});

test('revokes real workspace records, retains a shared pipeline, and restores access', async ({
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
  await openFixture(page, '/');
  await expect(page.getByText('Private record content')).toBeVisible();
  const pipeline = await context.newPage();
  await openFixture(pipeline, '/?view=pipeline');
  await expect(pipeline.getByTestId('shared-pipeline')).toBeVisible();
  await pipeline
    .getByRole('button', { name: 'Open referenced record' })
    .click();
  await expect(pipeline.getByText('Private record detail')).toBeVisible();
  await expect(pipeline.getByTestId('record-mounts')).toHaveText('1');

  allowed = false;
  for (const current of [page, pipeline]) {
    await current
      .getByRole('button', { name: 'Check access', exact: true })
      .click();
    await expect(
      current.getByText("You don't have access to CRM").first()
    ).toBeVisible();
  }
  await expect(page.getByText('Private record content')).toHaveCount(0);
  await expect(pipeline.getByText('Private record detail')).toHaveCount(0);
  await expect(pipeline.getByTestId('record-disposals')).toHaveText('1');
  const directory = process.env.CRM_ACCESS_SCREENSHOTS;
  if (directory)
    await pipeline.screenshot({
      path: `${directory}/record-denied-${info.project.name}.png`,
      fullPage: true,
    });

  for (const current of [page, pipeline]) {
    const navigation =
      info.project.name === 'phone'
        ? current.getByRole('navigation', { name: 'CRM views' })
        : current.locator('aside[data-view-sidebar]');
    await expect(
      navigation.getByRole('button', { name: 'Companies', exact: true })
    ).toHaveCount(0);
    await expect(
      navigation.getByRole('button', { name: /Private collection/ })
    ).toHaveCount(0);
    await navigation.getByRole('button', { name: /Shared pipeline/ }).click();
    await expect(current.getByTestId('shared-pipeline')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Open records route' }).click();
  await expect(
    page.getByText("You don't have access to CRM").first()
  ).toBeVisible();
  // The real workspace receives the pipeline editor's record action and rejects it.
  await pipeline
    .getByRole('button', { name: 'Open referenced record' })
    .click();
  await expect(pipeline.getByTestId('shared-pipeline')).toBeVisible();
  await expect(pipeline.getByTestId('record-mounts')).toHaveText('1');
  await expect(pipeline.getByText("You don't have access to CRM")).toHaveCount(
    0
  );

  allowed = true;
  for (const current of [page, pipeline]) {
    await current
      .getByRole('button', { name: 'Check access', exact: true })
      .click();
  }
  await expect(page.getByText('Private record content')).toBeVisible();
  await pipeline
    .getByRole('button', { name: 'Open referenced record' })
    .click();
  await expect(pipeline.getByText('Private record detail')).toBeVisible();
  for (const current of [page, pipeline]) {
    expect(
      await current.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
});

test('the denied real workspace can reopen collapsed navigation and return to a shared pipeline', async ({
  page,
}, info) => {
  let allowed = true;
  await page.route('**/fixture-authority', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'x-macro-crm-access': `00000000-0000-7000-8000-000000000001:${allowed ? 'allowed' : 'denied'}`,
      },
      body: '{}',
    })
  );
  await openFixture(page, '/?view=pipeline&collapsed');
  await page.getByRole('button', { name: 'Open referenced record' }).click();
  await expect(page.getByText('Private record detail')).toBeVisible();
  allowed = false;
  await page.getByRole('button', { name: 'Check access', exact: true }).click();
  await expect(
    page.getByText("You don't have access to CRM").first()
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: info.project.name === 'phone' ? 'Show sidebar' : 'Show navigation',
      exact: true,
    })
    .click();
  const sidebar = page.locator('aside[data-view-sidebar]');
  await sidebar.getByRole('button', { name: /Shared pipeline/ }).click();
  await expect(page.getByTestId('shared-pipeline')).toBeVisible();
  await expect(page.getByText('Private record detail')).toHaveCount(0);
});

test('a team-less proof preserves Customers navigation and the existing join-team empty state', async ({
  page,
}, info) => {
  await page.route('**/fixture-authority', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'x-macro-crm-access': 'none' },
      body: '{}',
    })
  );
  await openFixture(page, '/?no-team');
  await expect(page.getByText('Join a team to enable CRM')).toBeVisible();
  await expect(page.getByText("You don't have access to CRM")).toHaveCount(0);
  const navigation =
    info.project.name === 'phone'
      ? page.getByRole('navigation', { name: 'CRM views' })
      : page.locator('aside[data-view-sidebar]');
  await expect(
    navigation.getByRole('button', { name: 'People', exact: true })
  ).toBeVisible();
});

test('a cold deep link waits for proof and an allowed view survives a transient outage', async ({
  page,
}, info) => {
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
  await openFixture(page, '/');
  await expect(page.getByRole('status', { name: 'Loading…' })).toBeVisible();
  const navigation =
    info.project.name === 'phone'
      ? page.getByRole('navigation', { name: 'CRM views' })
      : page.locator('aside[data-view-sidebar]');
  await expect(
    navigation.getByRole('button', { name: 'People', exact: true })
  ).toBeVisible();
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
