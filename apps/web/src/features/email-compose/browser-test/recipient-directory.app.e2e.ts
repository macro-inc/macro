import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, baseURL }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const type = route.request().resourceType();
    if (
      url.origin !== new URL(baseURL!).origin ||
      url.pathname.includes('__macro_dev') ||
      type === 'xhr' ||
      (type === 'fetch' && !/\.(wasm|br)$/.test(url.pathname))
    )
      return route.abort();
    return route.continue();
  });
});

for (const composer of ['new', 'forward']) {
  test(`the ${composer} composer finds a late contact without loading the address book`, async ({
    page,
  }, info) => {
    const mobile = info.project.name === 'phone' ? '&mobile' : '';
    await page.goto(
      `/src/features/email-compose/browser-test/recipient-hotkeys.html?composer=${composer}&directory${mobile}`
    );
    await expect(page.getByTestId('directory-reads')).toHaveText('0');
    const to = page.getByRole('combobox').first();
    await to.fill('late');
    await expect(
      page.getByRole('option', { name: /Late Person/ })
    ).toBeVisible();
    await expect(page.getByTestId('directory-rows')).toHaveText('1');
    await to.press('Enter');
    await expect(page.getByText('Late Person', { exact: true })).toBeVisible();
    await to.fill('sender');
    await expect(page.getByTestId('directory-reads')).toHaveText('2');
    await expect(page.getByText('Loading options…')).toHaveCount(0);
    // A scoped thread address and the directory's user must not appear twice.
    await expect(
      page.getByRole('option').filter({ hasText: 'sender@example.com' })
    ).toHaveCount(1);
    await expect(page.getByText('Late Person', { exact: true })).toBeVisible();
    await to.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);
  });
}
