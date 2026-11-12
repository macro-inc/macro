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
