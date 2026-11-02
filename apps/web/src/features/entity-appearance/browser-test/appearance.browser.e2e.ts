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
  test(`immediate picks, failed-save recovery, removal, and emoji in ${theme}`, async ({
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
      .getByRole('textbox', { name: 'Search icons', exact: true })
      .fill('star');
    await page.getByRole('button', { name: 'Star', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('saved')).toHaveText(initial!);
    await page.getByRole('button', { name: 'Star', exact: true }).click();
    await page.getByRole('button', { name: 'Blue', exact: true }).click();
    await expect(page.getByTestId('saved')).toHaveText(
      '{"icon":{"kind":"macro","name":"star"},"color":"blue"}'
    );
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByTestId('saved')).toHaveText(
      '{"icon":null,"color":"blue"}'
    );
    await page.getByRole('radio', { name: 'Emoji', exact: true }).check();
    await page
      .getByRole('textbox', { name: 'Search emoji', exact: true })
      .fill('rocket');
    await page.getByRole('button', { name: 'Rocket', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Blue', exact: true })
    ).toHaveCount(0);
    await expect(page.getByTestId('saved')).toContainText('"kind":"emoji"');
  });
}
