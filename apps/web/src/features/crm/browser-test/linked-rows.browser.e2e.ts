import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.goto('/src/features/crm/browser-test/linked-rows.html');
  await expect(
    page.getByRole('heading', { name: 'Acme', exact: true })
  ).toBeVisible({ timeout: 15_000 });
});

test('company links show live previews, allow multiple rows, and unlink only the reference', async ({
  page,
}) => {
  await expect(page.getByText('Invoice 42', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Line items: Hosting, Support',
      exact: true,
    })
  ).toHaveAttribute('aria-readonly', 'true');
  const openSource = page.getByRole('button', { name: 'Open source row' });
  await openSource.focus();
  await page
    .getByRole('button', { name: 'Rename source' })
    .dispatchEvent('click');
  await expect(
    page.getByText('Invoice 42 paid', { exact: true })
  ).toBeVisible();
  await expect(openSource).toBeFocused();
  await page.getByRole('button', { name: 'Link row', exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: 'Billing / Invoices' }).click();
  await picker.getByRole('button', { name: 'Invoice 43', exact: true }).click();
  await expect(
    picker.getByRole('button', { name: 'Invoice 43 Linked' })
  ).toBeDisabled();
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.getByRole('button', { name: 'Link row', exact: true })
  ).toBeFocused();
  await page.getByRole('button', { name: 'Open source row' }).first().click();
  await expect(page.getByRole('status')).toHaveText('Opened: first');
  await page.getByRole('button', { name: 'Unlink row' }).first().click();
  await expect(page.getByText('Invoice 42 paid', { exact: true })).toHaveCount(
    0
  );
  await expect(page.getByText('Invoice 43', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fail refresh' }).click();
  await expect(page.getByText('Invoice 43', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Invoice 43', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke source' }).click();
  await expect(page.getByText('Invoice 43', { exact: true })).toHaveCount(0);
});

test.describe('phone drawers', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('deal links stay separate in the shared record panel on a phone', async ({
    page,
  }, testInfo) => {
    await page.getByRole('button', { name: 'Open deal' }).click();
    const record = page.getByRole('dialog');
    await expect(record.getByText('No linked rows available.')).toBeVisible();
    await record.getByRole('button', { name: 'Link row', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Link database row' });
    await picker.getByRole('button', { name: 'Billing / Invoices' }).click();
    await picker
      .getByRole('textbox', { name: 'Find a row' })
      .fill('Invoice 43');
    await picker
      .getByRole('button', { name: 'Invoice 43', exact: true })
      .click();
    await picker.getByRole('button', { name: 'Done' }).click();
    await expect(record.getByText('Invoice 43', { exact: true })).toBeVisible();
    await expect(
      record.getByRole('button', { name: 'Line items: Support', exact: true })
    ).toHaveAttribute('aria-readonly', 'true');
    await expect(record.getByText('Invoice 42', { exact: true })).toHaveCount(
      0
    );
    await expect(
      record.getByRole('button', { name: 'Link row', exact: true })
    ).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true);
    await record.getByRole('button', { name: 'Link row', exact: true }).click();
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(record.getByText('Invoice 43', { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('linked-rows-phone.png'),
    });
    await expect(
      record.getByRole('button', { name: 'Close record' })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open deal' })).toBeFocused();
    await expect(page.getByText('Invoice 42', { exact: true })).toBeVisible();
    await expect(page.getByText('Invoice 43', { exact: true })).toHaveCount(0);
  });
});
