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
    panel.getByText(/POSTs text, such as JSON, to this routine’s URL/)
  ).toBeVisible();
  await expect(panel.getByText('Only when the JSON body')).toBeVisible();
  // The server makes a URL only for a routine saved with the trigger.
  await expect(
    panel.getByText(/Add this trigger and save the routine/)
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Create URL' })).toHaveCount(
    0
  );
  await shot(page, 'panel-new');

  await panel.getByRole('button', { name: 'Add trigger' }).click();
  await expect(
    page.getByRole('button', { name: 'Change Webhook received trigger' })
  ).toBeVisible();
  await shot(page, 'list');

  // The saved trigger reopens its panel, where its URL is made, replaced or
  // deleted.
  await page.getByRole('button', { name: 'URL for Webhook received' }).click();
  const saved = page.getByRole('dialog', { name: 'Edit trigger' });
  await expect(saved.getByText('Only when the JSON body')).toBeVisible();
  await saved.getByRole('button', { name: 'Create URL' }).click();
  const url = saved.getByRole('textbox', { name: 'Webhook URL' });
  await expect(url).toHaveValue(/\/scheduled-action\/hooks\/whk_\w+$/);
  await expect(saved.getByRole('textbox', { name: 'Secret' })).toHaveValue(
    /^mrw_\w+$/
  );
  await expect(saved.getByText(/won’t be shown again/)).toBeVisible();
  await expect(saved.getByText(/curl -X POST/)).toBeVisible();
  await expect(saved.getByText(/Authorization: Bearer mrw_/)).toBeVisible();
  await expect(saved.getByText(/application\/json/)).toBeVisible();
  // Nothing on the panel runs past a phone's width.
  const overflow = await saved.evaluate(
    (element) => element.scrollWidth - element.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, 'panel-created');
});
