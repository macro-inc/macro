import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`a first-name match leads recent fuzzy people and CRM contacts on ${mobile ? 'phone' : 'desktop'}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.postData()?.includes('query CrmContacts')) {
        await route.fulfill({
          json: {
            data: {
              user: {
                id: 'viewer',
                soup: {
                  items: [
                    {
                      __typename: 'GraphqlSoupCrmContact',
                      id: 'contact',
                      contactTeamId: 'team',
                      companyId: 'company',
                      companyName: 'Acme company',
                      crmContactName: 'Alex',
                      email: 'external@example.com',
                      hidden: false,
                      firstInteraction: null,
                      lastInteraction: null,
                      createdAt: '2026-01-01T00:00:00Z',
                      updatedAt: '2026-01-01T00:00:00Z',
                      viewedAt: null,
                    },
                  ],
                  nextCursor: null,
                },
              },
            },
          },
        });
      } else if (
        url.hostname === 'localhost' &&
        !url.pathname.startsWith('/__macro_dev/')
      ) {
        await route.continue();
      } else {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: '{"responses":[]}',
        });
      }
    });
    await page.routeWebSocket('**/*', (socket) => socket.close());
    await page.goto(
      `http://localhost:${process.env.CHANNEL_DRAFT_TEST_PORT ?? '3006'}/src/features/channel/Input/browser-test/mention-ranking.html?people`
    );
    const editor = page.locator('[data-markdown-editable]');
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await editor.click();
    await page.keyboard.type('@alex');
    const menu = page.locator('.menu-surface');
    await expect(menu.getByTitle('Alex', { exact: true })).toBeVisible();
    await expect(menu.locator('.group').first()).toContainText('Alex Rowan');
    await page.screenshot({
      path: testInfo.outputPath(
        `people-ranking-${mobile ? 'phone' : 'desktop'}.png`
      ),
    });
    if (mobile) await menu.getByTitle('Alex Rowan').tap();
    else await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId('draft')).toContainText(
      'macro|alex@example.com'
    );
    expect(errors).toEqual([]);
    await context.close();
  });
}
