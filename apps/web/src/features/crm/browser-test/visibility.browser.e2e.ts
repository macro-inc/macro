import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    finishVisibilitySave(success: boolean): void;
    switchVisibilityRecord(): void;
  }
}

for (const device of [
  { name: 'desktop', width: 1280, height: 800, hasTouch: false },
  { name: 'phone', width: 390, height: 844, hasTouch: true },
  { name: 'tablet', width: 1024, height: 768, hasTouch: true },
]) {
  test.describe(device.name, () => {
    // The first page compiles the production UI dependencies on a cold server.
    test.setTimeout(180_000);
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.hasTouch,
    });
    test.beforeEach(async ({ page }) => {
      await page.routeWebSocket('**', (socket) => socket.close());
      await page.route('https://**', (route) => route.abort());
      await page.route('**/__macro_dev/**', (route) => route.abort());
    });

    for (const kind of ['company', 'contact']) {
      test(`${kind} removal can cancel, retry and restore`, async ({
        page,
      }, testInfo) => {
        await page.goto(
          `/src/features/crm/browser-test/visibility.html?kind=${kind}`
        );
        const remove = page.getByRole('button', {
          name: 'Remove from CRM',
          exact: true,
        });
        await remove.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toBeInViewport({ ratio: 1 });
        await expect(dialog).not.toHaveAttribute('data-transitioning');
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(page.getByLabel('Visibility writes')).toHaveText('0');

        await remove.click();
        await expect(dialog).toBeInViewport({ ratio: 1 });
        await expect(dialog).not.toHaveAttribute('data-transitioning');
        await page.screenshot({
          path: testInfo.outputPath(`${kind}-${device.name}.png`),
        });
        const confirm = dialog.getByRole('button', {
          name: 'Remove from CRM',
          exact: true,
        });
        await confirm.click();
        await expect(confirm).toBeDisabled();
        await expect(page.getByLabel('Visibility writes')).toHaveText('1');
        await page.evaluate(() => window.finishVisibilitySave(false));
        await expect(dialog).toBeVisible();
        await confirm.click();
        await page.evaluate(() => window.finishVisibilitySave(true));
        await expect(dialog).not.toBeVisible();
        await expect(page.getByLabel('Visibility writes')).toHaveText('2');

        await page
          .getByRole('button', { name: 'Restore to CRM', exact: true })
          .click();
        await expect(dialog).toBeInViewport({ ratio: 1 });
        await expect(dialog).not.toHaveAttribute('data-transitioning');
        await dialog
          .getByRole('button', { name: 'Restore to CRM', exact: true })
          .click();
        await page.evaluate(() => window.finishVisibilitySave(true));
        await expect(dialog).not.toBeVisible();
        await expect(remove).toBeEnabled();
        await expect(page.getByLabel('Visibility writes')).toHaveText('3');
        await page.getByRole('button', { name: 'Toggle admin role' }).click();
        await expect(remove).toBeDisabled();
      });
    }

    test('record navigation discards an open confirmation', async ({
      page,
    }) => {
      await page.goto('/src/features/crm/browser-test/visibility.html');
      await page
        .getByRole('button', { name: 'Remove from CRM', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.evaluate(() => window.switchVisibilityRecord());
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.evaluate(() => window.switchVisibilityRecord());
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(page.getByLabel('Visibility writes')).toHaveText('0');
    });
  });
}
