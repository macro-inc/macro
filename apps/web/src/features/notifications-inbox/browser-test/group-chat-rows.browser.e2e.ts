import { expect, type Page, test } from '@playwright/test';

const SIZES = [
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
];

const PAGE =
  '/src/features/notifications-inbox/browser-test/group-chat-rows.html';

const rowText = (page: Page, id: string) =>
  page.getByTestId(id).locator('[data-notification-row]').innerText();

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
      isMobile: size.touch,
    });

    test('a group chat row shows the chat, not its last sender', async ({
      page,
    }) => {
      await page.goto(PAGE);
      // The first load pre-bundles the app's dependencies.
      await expect(page.getByTestId('dm')).toBeVisible({ timeout: 180_000 });

      const named = page.getByTestId('named-group');
      await expect(named.locator('[data-group-chat-avatar]')).toBeVisible();
      await expect(named.locator('[data-kind-badge]')).toHaveCount(0);
      const namedText = await rowText(page, 'named-group');
      expect(namedText).toContain('remote');
      expect(namedText).toContain('Ana: Message 9');
      expect(namedText).not.toContain('others');

      // The row is named for the reader: the notification's copy lists the
      // reader and leaves out its sender.
      const unnamedText = await rowText(page, 'unnamed-group');
      expect(unnamedText).toContain('Ana, Leo and 4 others');
      expect(unnamedText).not.toContain('Viewer');
      await expect(
        page.getByTestId('unnamed-group').locator('[data-group-chat-avatar]')
      ).toBeVisible();

      for (const id of ['public', 'dm']) {
        await expect(
          page.getByTestId(id).locator('[data-group-chat-avatar]')
        ).toHaveCount(0);
      }

      await page.screenshot({
        path: test.info().outputPath(`group-chat-rows-${size.name}.png`),
        fullPage: true,
      });
    });
  });
}

test('Team request cards follow current vault visibility and pass their row to the opener', async ({
  page,
}) => {
  // The context providers remain real; their unrelated reads use empty synthetic data.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (loopback && request.method() === 'GET') {
      const responses: Record<string, object> = {
        '/__macro_dev/gateway/dss/comms/channels': {
          items: [],
          next_cursor: null,
        },
        '/__macro_dev/gateway/dss/channels/activity': [],
        '/__macro_dev/gateway/email/email/links': { links: [] },
      };
      const response = responses[url.pathname];
      if (response)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(response),
        });
    }
    if (
      (!loopback && !['data:', 'blob:'].includes(url.protocol)) ||
      url.pathname.startsWith('/__macro_dev/')
    )
      return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.goto(`${PAGE}?passwordRequests=1`);
  const row = page.getByTestId('vault-request');
  await expect(row).toBeVisible({ timeout: 180_000 });
  await expect(row).toContainText('Synthetic login');
  await expect(page.getByTestId('invalid-vault-request')).toHaveCount(0);
  await row.locator('[data-notification-row]').click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-opened-inbox-row',
    'vault-request'
  );
  await page.getByRole('button', { name: 'Toggle vault visibility' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('dm')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle vault visibility' }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Change current team' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('dm')).toBeVisible();
});
