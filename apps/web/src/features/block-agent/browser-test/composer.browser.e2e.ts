import { expect, test } from '@playwright/test';

test('the session composer plus button lists connections and opens their settings', async ({
  page,
}) => {
  // Never reach a real service; the menu reads only the two connection lists.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.route('**/cognition/pipedream/mcp/connections', (route) =>
    route.fulfill({
      json: [
        {
          app_slug: 'notion',
          server_name: 'Notion',
          enabled: true,
          provider: 'pipedream',
        },
      ],
    })
  );
  await page.route('**/cognition/mcp/servers', (route) =>
    route.fulfill({ json: [] })
  );
  await page.goto('/composer.html');

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Notion', { exact: true })).toBeVisible();
  await expect(page.getByText('Add connections')).toBeVisible();
  await expect(page.getByText('Manage connections')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('plus-menu.png') });

  await page.getByText('Add connections').click();
  await expect(
    page.getByRole('dialog').getByText('Connections', { exact: true })
  ).toBeVisible();
});
