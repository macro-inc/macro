import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`CRM records remain record links beside matching people on ${mobile ? 'phone' : 'desktop'}`, async ({
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
    const contactQueries: string[] = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.postData()?.includes('query CrmContacts')) {
        const body = request.postDataJSON();
        const cursor = body.variables.input.continuation?.cursor;
        contactQueries.push(cursor ?? 'first');
        const index = cursor ? 2 : 1;
        await route.fulfill({
          json: {
            data: {
              user: {
                id: 'viewer',
                soup: {
                  items: [
                    {
                      __typename: 'GraphqlSoupCrmContact',
                      id: `contact-${index}`,
                      contactTeamId: 'team',
                      companyId: 'company',
                      companyName: 'Acme company',
                      crmContactName: `Acme contact ${index}`,
                      email:
                        index === 1
                          ? 'member@example.com'
                          : 'external@example.com',
                      hidden: false,
                      firstInteraction: null,
                      lastInteraction: null,
                      createdAt: '2026-01-01T00:00:00Z',
                      updatedAt: '2026-01-01T00:00:00Z',
                      viewedAt: null,
                    },
                  ],
                  nextCursor: cursor ? null : 'next-page',
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
      `http://localhost:${process.env.CHANNEL_DRAFT_TEST_PORT ?? '3006'}/src/features/channel/Input/browser-test/mention-ranking.html?crm`
    );
    const editor = page.locator('[data-markdown-editable]');
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await editor.click();
    await page.keyboard.type('@acme');
    const menu = page.locator('.menu-surface');
    await expect(menu.getByTitle('Acme contact 1')).toBeVisible({
      timeout: 15_000,
    });
    await expect(menu.getByTitle('Acme member')).toBeVisible();
    await expect(menu.getByText('Acme company', { exact: true })).toBeVisible();
    if (!mobile) {
      await page.screenshot({
        path: testInfo.outputPath('crm-mentions-desktop.png'),
      });
      // Expanding CRM must page contacts and exclude user mentions.
      await menu
        .getByText('CRM', { exact: true })
        .locator('..')
        .getByRole('button', { name: /View all/ })
        .click();
      await expect(menu.getByTitle('Acme contact 2')).toBeVisible();
      await expect(menu.getByTitle('Acme member')).toHaveCount(0);
    } else {
      await expect(menu.locator('.group').first()).toContainText('Acme member');
      await expect(menu.getByTitle('Acme contact 2')).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('crm-mentions-phone.png'),
      });
    }
    expect(contactQueries).toContain('next-page');
    const contact = menu.getByTitle('Acme contact 1');
    if (mobile) await contact.tap();
    else await contact.click();
    await expect(menu).toHaveCount(0);
    const chip = editor.locator('[data-document-mention][data-document-id]');
    await expect(chip).toHaveAttribute('data-document-id', 'contact-1');
    await expect(chip).toHaveAttribute('data-block-name', 'contact');
    await expect(page.getByTestId('draft')).toContainText(
      '"blockName":"contact"'
    );
    expect(errors).toEqual([]);
    await context.close();
  });
}
