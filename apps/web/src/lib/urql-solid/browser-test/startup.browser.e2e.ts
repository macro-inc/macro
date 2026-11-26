import { expect, test } from '@playwright/test';

test.skip(
  ({ hasTouch }) => hasTouch,
  'Row context menus use pointer interaction'
);

for (const owner of ['fresh', 'upgrade', 'allowed']) {
  test(`keeps the open row menu during ${owner} startup recovery`, async ({
    page,
  }) => {
    await page.goto(`/startup.html?owner=${owner}`);
    await page
      .getByRole('row', { name: 'Agenda', exact: true })
      .click({ button: 'right' });
    const copy = page.getByRole('menuitem', { name: 'Copy Link' });
    await expect(copy).toBeVisible();

    await page.evaluate(() => window.startupRecovery.completeOwner());
    await expect(copy).toBeVisible();
    // The open modal menu hides other nodes from the accessibility tree.
    // Inspect the row itself so preserving the menu cannot hide this assertion.
    await expect(page.locator('[role="row"]')).toBeVisible();
    await expect(page.locator('[role="row"]')).toHaveText('Agenda');

    await page.evaluate(() => window.startupRecovery.refetch());
    await expect(copy).toBeVisible();
    await page.evaluate(() => window.startupRecovery.releaseReads());
    await expect(page.locator('[role="row"]')).toHaveText('Updated agenda');
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(page.getByRole('status', { name: 'Copied row' })).toHaveText(
      'thread-1'
    );
  });
}

for (const owner of ['denied', 'other-account']) {
  test(`retires the open row menu for a ${owner} owner`, async ({ page }) => {
    await page.goto(`/startup.html?owner=${owner}`);
    await page
      .getByRole('row', { name: 'Agenda', exact: true })
      .click({ button: 'right' });
    await expect(
      page.getByRole('menuitem', { name: 'Copy Link' })
    ).toBeVisible();
    await page.evaluate(() => window.startupRecovery.completeOwner());
    await expect(page.locator('[role="row"]')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Copy Link' })).toHaveCount(
      0
    );
  });
}
