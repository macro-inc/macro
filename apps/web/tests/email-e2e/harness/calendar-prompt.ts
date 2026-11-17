import type { Page } from '@playwright/test';

/**
 * Stack inboxes grant mail alone, so the app asks to enable each inbox's
 * calendar in a toast that can cover the composer. Close it whenever it
 * shows, as a person who said "Not now" would.
 */
export async function closeCalendarPrompts(page: Page): Promise<void> {
  const prompt = page
    .getByRole('status')
    .filter({ hasText: 'Macro can now sync your calendar' });
  await page.addLocatorHandler(prompt, async (toast) => {
    await toast.getByRole('button', { name: 'Not now' }).click();
  });
}
