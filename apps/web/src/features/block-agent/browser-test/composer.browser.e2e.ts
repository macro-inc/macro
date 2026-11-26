import { expect, test } from '@playwright/test';

test('the session composer plus button lists connections and opens their settings', async ({
  page,
}) => {
  // Never reach a real service; the menu reads only the connector list.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.route('**/cognition/connectors', (route) =>
    route.fulfill({
      json: [
        {
          key: 'app/notion',
          target: { type: 'app', slug: 'notion' },
          name: 'Notion',
          status: 'connected',
          connectable: true,
          mcp: true,
          api: true,
          importAvailable: false,
        },
      ],
    })
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
