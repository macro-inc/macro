import { expect, test } from '@playwright/test';

test('request and approve initial View access', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/e2e/fixtures/access-requests.html?no-access');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByLabel('Requested access level')).toHaveText('View');
  if (testInfo.project.name === 'mobile-touch') {
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(
      0
    );
    expect(await page.evaluate(() => innerWidth)).toBe(390);
    await expect(page.locator('html')).toHaveAttribute(
      'data-touch-device',
      'true'
    );
    expect(
      await page
        .getByLabel('Requested access level')
        .evaluate((button) => button.getBoundingClientRect().height)
    ).toBeGreaterThanOrEqual(36);
    await page.screenshot({
      path: testInfo.outputPath('request-access-touch.png'),
    });
  }
  await page
    .getByRole('button', { name: 'Request access', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Request sent' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Act as owner' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Permission requests' })
  ).toContainText('Requested view access');
  await expect(page.getByLabel('Access to grant')).toHaveText('View');
  await page.getByRole('button', { name: 'Grant access' }).click();
  await expect(
    page.getByRole('region', { name: 'Permission requests' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Act as requester' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByLabel('Requested access level').click();
  await expect(
    page.getByRole('menuitem', { name: 'View', exact: true })
  ).toHaveCount(0);
});

// Fixture sources keep this browser suite independent of hosted accounts.
for (const viewport of [
  { width: 1200, height: 850 },
  { width: 390, height: 844 },
]) {
  test(`request, change, grant and remove access at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/tests/e2e/fixtures/access-requests.html');
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByLabel('Requested access level').click();
    await page.getByRole('menuitem', { name: 'Comment', exact: true }).click();
    await page
      .getByRole('button', { name: 'Request access', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Request sent' })
    ).toBeDisabled();
    await page.getByLabel('Requested access level').click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Change request' }).click();
    await expect(
      page.getByRole('button', { name: 'Request sent' })
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Share', exact: true })
    ).toBeFocused();
    await page.getByRole('button', { name: 'Act as owner' }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Permission requests' })
    ).toContainText('Requested edit access');
    await page.getByLabel('Access to grant').click();
    await page.getByRole('menuitem', { name: 'Comment', exact: true }).click();
    await page.getByRole('button', { name: 'Grant access' }).click();
    await expect(
      page.getByRole('region', { name: 'Permission requests' })
    ).toHaveCount(0);
    await expect(page.getByLabel("Person's access level")).toHaveText(
      'Comment'
    );
    await page.getByRole('button', { name: 'Remove access' }).click();
    await expect(page.getByLabel("Person's access level")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  });
}

test('PDF choices, failed submit, cancellation and denial cooldown', async ({
  page,
}) => {
  await page.goto('/tests/e2e/fixtures/access-requests.html?pdf');
  await page.getByRole('button', { name: 'Fail next request' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByLabel('Requested access level').click();
  await expect(
    page.getByRole('menuitem', { name: 'Edit', exact: true })
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Request access', exact: true })
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .getByRole('button', { name: 'Request access', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(
    page.getByRole('button', { name: 'Request access', exact: true })
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Request access', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Request sent' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Act as owner' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Deny' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Act as requester' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByText(/Request denied/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Request access', exact: true })
  ).toBeDisabled();
});
