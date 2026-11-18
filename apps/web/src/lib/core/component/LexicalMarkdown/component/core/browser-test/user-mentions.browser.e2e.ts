import { expect, test } from '@playwright/test';

for (const resolveName of [true, false]) {
  test(`ID-only mentions render and survive editing (name lookup ${resolveName ? 'succeeds' : 'fails'})`, async ({
    page,
    context,
  }, testInfo) => {
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/user/get_names_with_email')) {
        await route.fulfill({
          status: resolveName ? 200 : 500,
          contentType: 'application/json',
          body: JSON.stringify({
            names: [
              {
                id: 'macro|user@example.com',
                first_name: 'Example',
                last_name: 'User',
              },
            ],
          }),
        });
      } else if (
        url.hostname === 'localhost' &&
        !url.pathname.includes('/__macro_dev/')
      ) {
        await route.continue();
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: '{}',
        });
      }
    });
    await page.routeWebSocket('**/*', (socket) => socket.close());
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const markdown =
      '<m-user-mention>{"userId":"macro|user@example.com"}</m-user-mention>';
    const nameRequest = page.waitForResponse((response) =>
      response.url().endsWith('/user/get_names_with_email')
    );
    await page.goto(
      `/src/lib/core/component/LexicalMarkdown/component/core/browser-test/links.html?markdown=${encodeURIComponent(markdown)}`
    );
    await nameRequest;

    const label = resolveName ? '@Example' : '@user';
    const rendered = page.getByTestId('input').locator('[data-user-mention]');
    const editor = page.getByRole('textbox', { name: 'Message' });
    await expect(rendered).toHaveText(label);
    await expect(rendered).toHaveAttribute(
      'data-user-id',
      'macro|user@example.com'
    );
    await expect(editor.locator('[data-user-mention]')).toHaveText(label);
    await page
      .getByRole('button', { name: 'Save message', exact: true })
      .click();
    await expect(
      page.getByTestId('saved').locator('[data-user-mention]')
    ).toHaveText(label);
    await page.getByRole('button', { name: 'Reopen saved message' }).click();
    await expect(editor.locator('[data-user-mention]')).toHaveText(label);
    expect(errors).toEqual([]);
    await page
      .getByTestId('input')
      .locator('..')
      .screenshot({
        path: testInfo.outputPath('user-mention.png'),
      });
  });
}
