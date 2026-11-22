import { expect, test } from '@playwright/test';

test('the session PR chip states a status only when GitHub synced one', async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.goto('/pr-chip.html');

  const chip = (label: string) =>
    page.locator(`[data-row="${label}"] [data-agent-pull-request]`);

  // A PR GitHub never synced: its status is unknown, so only the number.
  await expect(chip('Not synced')).toHaveText('#11755');
  await expect(chip('Not synced')).toHaveAttribute(
    'href',
    'https://github.com/macro-inc/macro/pull/11755'
  );
  await expect(chip('Synced, no status')).toHaveText('#11759');

  await expect(chip('Synced, open')).toHaveText('#11756Open');
  await expect(chip('Synced, merged')).toHaveText('#11757Merged');
  await expect(chip('Synced, closed')).toHaveText('#11758Closed');

  await page.screenshot({ path: test.info().outputPath('pr-chips.png') });
});
