import { expect, test } from '@playwright/test';

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
  await expect(pipeline.getByText('Private collection')).toHaveCount(0);
  await expect(
    pipeline.getByRole('heading', { name: 'Shared pipeline' })
  ).toBeVisible();
  const directory = process.env.CRM_ACCESS_SCREENSHOTS;
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
