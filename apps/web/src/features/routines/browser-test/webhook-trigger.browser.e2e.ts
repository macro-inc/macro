import { expect, type Page, test } from '@playwright/test';

const SHOTS = process.env.ROUTINE_TRIGGER_SCREENSHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS)
    await page.screenshot({
      path: `${SHOTS}/${name}-${test.info().project.name}.png`,
    });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      await route.continue();
    else await route.fulfill({ status: 401, body: '{}' });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add trigger' })).toBeVisible({
    timeout: 60_000,
  });
});

test('a webhook trigger is added from its own group and gets a URL', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add trigger' }).click();
  await expect(page.getByRole('menuitem', { name: 'GitHub' })).toBeVisible();
  await shot(page, 'menu');
  const group = page.getByRole('menuitem', { name: 'Webhooks' });
  await expect(group).toBeVisible();
  await group.click();
  await page.getByRole('menuitem', { name: /Webhook received/ }).click();

  const panel = page.getByRole('dialog', { name: 'Add trigger' });
  await expect(
    panel.getByText(/POSTs text to this routine’s secret URL/)
  ).toBeVisible();
  await expect(panel.getByText('Only when the JSON body')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Create URL' })).toBeVisible();
  await shot(page, 'panel-new');
  await panel.getByRole('button', { name: 'Create URL' }).click();
  const url = panel.getByRole('textbox', { name: 'Webhook URL' });
  await expect(url).toHaveValue(/\/scheduled-actions\/webhooks\/mrw_/);
  await expect(panel.getByText(/won’t be shown again/)).toBeVisible();
  await expect(panel.getByText(/curl -X POST/)).toBeVisible();
  await shot(page, 'panel-created');

  await panel.getByRole('button', { name: 'Add trigger' }).click();
  await expect(
    page.getByRole('button', { name: 'Change Webhook received trigger' })
  ).toBeVisible();
  await shot(page, 'list');
});
