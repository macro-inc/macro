import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, baseURL }) => {
  // The fixture's providers would otherwise reach the hosted dev backend.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const type = route.request().resourceType();
    if (
      url.origin !== new URL(baseURL!).origin ||
      url.pathname.includes('__macro_dev') ||
      type === 'xhr' ||
      (type === 'fetch' && !/\.(wasm|br)$/.test(url.pathname))
    )
      return route.abort();
    // Chrome fails every request in flight when the machine's network
    // changes, which leaves the page without part of its modules; the test
    // process fetches them instead.
    try {
      const response = await route.fetch();
      await route.fulfill({ response });
    } catch {
      await route.continue().catch(() => {});
    }
  });
});

// Class recipient-selector-commits-wrong-address. When this fails, Enter on a
// complete address adds whichever suggestion the list put first once contacts
// loaded (a plus-addressed variant of the address), so the mail goes to an
// address the sender never typed; or Enter on text that is no address drops
// the text and a recipient already chosen.
test('Enter adds the address typed, not a similar contact, and keeps text that is no address', async ({
  page,
}) => {
  await page.goto(
    '/src/features/email-compose/browser-test/recipient-hotkeys.html?composer=new&directory'
  );
  const to = page.getByRole('combobox').first();
  await to.click();
  await page.keyboard.type('ann@example.com');
  // Both contacts are listed, the similar address among them.
  await expect(
    page.getByRole('option').filter({ hasText: 'ann+news@example.com' })
  ).toBeVisible();
  await page.keyboard.press('Enter');

  const chips = page.locator('[draggable="true"]');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText('ann@example.com');
  await expect(chips.first()).not.toContainText('ann+news');
  await expect(to).toHaveValue('');

  await page.keyboard.type('not an address');
  await page.keyboard.press('Enter');
  await expect(to).toHaveValue('not an address');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText('ann@example.com');
});
