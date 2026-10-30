import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.error(error.message));
  // Host IP changes flush Chromium's socket pool; keep loopback fixture traffic in Node.
  await page.route('http://localhost:*/**', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    await route.fulfill({ response });
  });
  await page.route('https://**', (route) => route.abort());
  await page.routeWebSocket('**', (socket) => socket.close());
});

for (const theme of ['light', 'dark']) {
  test(`atomic Apply, failed-save recovery, Cancel, and native emoji in ${theme}`, async ({
    page,
  }) => {
    await page.goto(
      `/src/features/entity-appearance/browser-test/appearance.html?theme=${theme}`
    );
    await expect(page.getByTestId('saved')).toBeVisible({ timeout: 60_000 });
    const initial = await page.getByTestId('saved').textContent();
    await page.getByRole('button', { name: 'Fail next save' }).click();
    await page.getByRole('button', { name: 'Edit entity icon' }).click();
    await page
      .getByRole('textbox', { name: 'Search icons or emoji' })
      .fill('star');
    await page.getByRole('button', { name: 'star', exact: true }).click();
    await page.getByRole('button', { name: 'Blue', exact: true }).click();
    await page.screenshot({
      path: `/tmp/entity-appearance-picker-${test.info().project.name}-${theme}.png`,
    });
    await expect(page.getByTestId('saved')).toHaveText(initial!);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('saved')).toHaveText(initial!);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByTestId('attempts')).toHaveText('2');
    await expect(page.getByTestId('saved')).toHaveText(
      '{"icon":{"kind":"macro","name":"star"},"color":"blue"}'
    );

    await page.getByRole('button', { name: 'Edit entity icon' }).click();
    await page.getByRole('button', { name: 'Reset all', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('saved')).toContainText('"name":"star"');
    await page.getByRole('button', { name: 'Edit entity icon' }).click();
    await page.getByText('Emoji', { exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Search icons or emoji' })
      .fill('rocket');
    await page.getByRole('option').filter({ hasText: '🚀' }).first().click();
    await expect(
      page.getByRole('button', { name: 'Blue', exact: true })
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByTestId('saved')).toContainText('"kind":"emoji"');
    await page.screenshot({
      path: `/tmp/entity-appearance-${test.info().project.name}-${theme}.png`,
    });
  });
}
