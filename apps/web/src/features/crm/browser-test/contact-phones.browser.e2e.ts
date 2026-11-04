import { expect, test } from '@playwright/test';

const PAGE = '/src/features/crm/browser-test/contact-phones.html';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
});

test.describe('desktop', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test('numbers sit beside a Call link and are edited in a dialog', async ({
    page,
  }, testInfo) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    const details = page.getByLabel('Contact details');
    await expect(details.getByText('+1555010')).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      details.getByRole('link', { name: 'Call +1555010' })
    ).toHaveAttribute('href', 'tel:+1555010');
    await expect(
      details.getByRole('link', { name: 'Call +1555010' })
    ).toHaveText('Call');

    await details.getByRole('button', { name: 'Edit phones' }).click();
    const dialog = page.getByRole('dialog', { name: 'Phone numbers' });
    await dialog.getByRole('button', { name: 'Add number' }).click();
    await dialog
      .getByRole('textbox', { name: 'Phone number 2' })
      .fill('020 123');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('country code');

    await dialog
      .getByRole('textbox', { name: 'Phone number 2' })
      .fill('+44 20 123');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      details.getByRole('link', { name: 'Call +4420123' })
    ).toHaveAttribute('href', 'tel:+4420123');
    await page.screenshot({ path: testInfo.outputPath('desktop.png') });

    const sources = page.getByLabel('Call sources');
    await expect(
      sources.getByRole('link', { name: 'Open in Granola' })
    ).toHaveAttribute('href', 'https://granola.example/notes/1');
    // With a link, without one, and on a list row.
    await expect(sources.getByText('Granola')).toHaveCount(3);
    await expect(sources.getByText('Macro')).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the whole number pill opens the dialer', async ({ page }, testInfo) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    const details = page.getByLabel('Contact details');
    const pill = details.getByRole('link', { name: 'Call +1555010' });
    await expect(pill).toBeVisible({ timeout: 60_000 });
    await expect(pill).toHaveAttribute('href', 'tel:+1555010');
    await expect(pill).toContainText('+1555010');
    await expect(
      details.getByRole('link', { name: 'Call', exact: true })
    ).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('phone.png') });
  });
});
