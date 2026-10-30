import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`webhooks skip the empty step and preserve management (${mobile ? 'phone' : 'desktop'})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
      isMobile: mobile,
      hasTouch: mobile,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    await page.route('https://**', (route) => route.abort());
    await page.route('**/__macro_dev/**', (route) => route.abort());
    await page.goto(
      'http://localhost:' +
        (process.env.DATABASE_TABLE_TEST_PORT ?? '3005') +
        '/src/features/block-database/browser-test/webhooks.html',
      { waitUntil: 'domcontentloaded' }
    );
    const opener = page.getByRole('button', { name: 'Webhooks', exact: true });
    await opener.click();
    const url = page.getByRole('textbox');
    await expect(url).toHaveValue(/example-token-1$/);
    await expect(page.getByLabel('Creations')).toHaveText('1');
    await page.getByRole('button', { name: 'Copy webhook URL' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /example-token-1$/
    );
    await page.screenshot({ path: test.info().outputPath('webhooks.png') });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(
      page.getByRole('button', { name: 'Delete webhook' })
    ).toHaveCount(1);
    await expect(page.getByLabel('Creations')).toHaveText('1');
    await page
      .getByRole('button', { name: 'Create webhook', exact: true })
      .click();
    await expect(url).toHaveValue(/example-token-2$/);
    await expect(
      page.getByRole('button', { name: 'Delete webhook' })
    ).toHaveCount(2);
    await page.getByRole('button', { name: 'Delete webhook' }).last().click();
    await expect(url).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete webhook' }).click();
    await expect(
      page.getByRole('button', { name: 'Delete webhook' })
    ).toHaveCount(0);
    await expect(page.getByLabel('Creations')).toHaveText('2');
    await context.close();
  });
}
