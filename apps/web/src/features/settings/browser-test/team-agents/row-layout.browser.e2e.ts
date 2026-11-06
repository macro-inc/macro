import { expect, test } from '@playwright/test';

test('human and agent rows share height, identity and status columns', async ({
  page,
}, testInfo) => {
  await page.goto('/row-layout.html');
  await expect(page.locator('[data-member-kind]')).toHaveCount(3);
  const geometry = await page
    .locator('[data-member-kind]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const rect = row.getBoundingClientRect();
        const identity = row
          .querySelector('[data-member-identity]')!
          .getBoundingClientRect();
        const status = row
          .querySelector('[data-member-status]')!
          .getBoundingClientRect();
        const actions = row
          .querySelector('[data-member-actions]')!
          .getBoundingClientRect();
        const name = row
          .querySelector('[data-member-name]')!
          .getBoundingClientRect();
        return {
          height: rect.height,
          identity: identity.x,
          status: status.x,
          actions: actions.x,
          nameRight: name.right,
          identityRight: identity.right,
        };
      })
    );
  for (const row of geometry.slice(1)) {
    for (const key of ['height', 'identity', 'status', 'actions'] as const) {
      expect(Math.abs(row[key] - geometry[0][key])).toBeLessThanOrEqual(0.5);
    }
  }
  for (const row of geometry)
    expect(row.nameRight).toBeLessThanOrEqual(row.identityRight + 0.5);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  ).toBe(false);
  await expect(page.getByText('Billed', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('progressbar', { name: 'Agent setup' })
  ).toContainText('Connecting');
  await page.screenshot({
    path: testInfo.outputPath('member-row-alignment.png'),
    fullPage: true,
  });
});
