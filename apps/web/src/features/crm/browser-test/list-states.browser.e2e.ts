import { expect, test } from '@playwright/test';

for (const device of [
  { name: 'desktop', width: 1280, height: 800, hasTouch: false },
  { name: 'phone', width: 390, height: 844, hasTouch: true },
]) {
  test.describe(device.name, () => {
    test.setTimeout(60_000);
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.hasTouch,
    });
    test.beforeEach(async ({ page }) => {
      await page.routeWebSocket('**', (socket) => socket.close());
      await page.route('https://**', (route) => route.abort());
      await page.route('**/__macro_dev/**', (route) => route.abort());
    });

    test('raises the empty state and keeps create and database navigation usable', async ({
      page,
    }, info) => {
      await page.goto('/src/features/crm/browser-test/list-states.html');
      const heading = page.getByRole('heading', {
        name: 'No linked databases yet',
      });
      await expect(heading).toBeVisible({ timeout: 30000 });
      const box = await heading.boundingBox();
      expect(box!.y).toBeGreaterThan(device.height * 0.35);
      expect(box!.y).toBeLessThan(device.height * 0.65);
      await page
        .getByRole('button', { name: 'New database', exact: true })
        .last()
        .click();
      await expect(page.getByLabel('Last action')).toHaveText('create');
      await page
        .getByRole('radio', { name: 'Tasks', exact: true })
        .press('Space');
      await expect(page.getByLabel('Selected section')).toHaveText('tasks');
      await page
        .getByRole('radio', { name: 'Databases', exact: true })
        .press('Space');
      await expect(page.getByLabel('Selected section')).toHaveText('databases');
      await page.screenshot({ path: info.outputPath('empty.png') });
    });

    test('clears an empty search and retries errors', async ({
      page,
    }, info) => {
      await page.goto(
        '/src/features/crm/browser-test/list-states.html?state=search'
      );
      await expect(
        page.getByRole('heading', { name: 'No matching databases' })
      ).toBeVisible({ timeout: 30000 });
      await page.getByRole('button', { name: 'Clear search' }).last().click();
      await expect(page.getByRole('searchbox')).toHaveValue('');
      await expect(
        page.getByRole('heading', { name: 'No linked databases yet' })
      ).toBeVisible();
      await page.goto(
        '/src/features/crm/browser-test/list-states.html?state=error'
      );
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByLabel('Last action')).toHaveText('retry');
      await page.screenshot({ path: info.outputPath('error.png') });
    });

    test('renders a skeleton during loading', async ({ page }, info) => {
      await page.goto(
        '/src/features/crm/browser-test/list-states.html?state=loading'
      );
      await expect(
        page.getByRole('status', { name: 'Loading databases' })
      ).toBeVisible({ timeout: 30000 });
      await expect(page.getByRole('heading')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('loading.png') });
    });
  });
}
