import { expect, type Page, test } from '@playwright/test';
import { stayLocal } from './stay-local';

const PAGE =
  '/src/features/notifications-inbox/browser-test/notifications-view.html';

const ROW_ID = 'dm-leo';

async function openInbox(page: Page) {
  await stayLocal(page);
  await page.goto(PAGE);
  // The first load pre-bundles the app's dependencies.
  await expect(page.locator(`#${ROW_ID}`)).toBeVisible({ timeout: 180_000 });
}

const heightOf = async (page: Page, id: string) =>
  (await page.locator(`#${id}`).boundingBox())?.height ?? 0;

test.describe('desktop', () => {
  test.use({ viewport: { width: 1100, height: 700 } });

  test('Display options switch the list to one-line Condensed rows and back', async ({
    page,
  }) => {
    await openInbox(page);
    // Display options take the settings gear's place.
    await expect(
      page.getByRole('button', { name: 'Notification settings' })
    ).toHaveCount(0);
    // All and Unread are the list's only tabs.
    await expect(
      page.getByRole('radiogroup', { name: 'Status' }).getByRole('radio')
    ).toHaveCount(2);
    const full = await heightOf(page, ROW_ID);
    expect(full).toBeGreaterThan(32);

    await page.getByRole('button', { name: 'Display options' }).click();
    const condensed = page.getByRole('menuitemcheckbox', { name: 'Condensed' });
    await expect(condensed).toHaveAttribute('aria-checked', 'false');
    await expect(
      page.getByRole('menuitem', { name: /Notification settings/ })
    ).toBeVisible();

    await condensed.click();
    await expect(condensed).toHaveAttribute('aria-checked', 'true');
    // One line: a Condensed row is Home's 32px row.
    await expect.poll(() => heightOf(page, ROW_ID)).toBeLessThanOrEqual(32);

    await condensed.click();
    await expect(condensed).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => heightOf(page, ROW_ID)).toBe(full);
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('has no Display options', async ({ page }) => {
    await openInbox(page);
    await expect(
      page.getByRole('button', { name: 'Display options' })
    ).toHaveCount(0);
  });
});
