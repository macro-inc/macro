import { expect, test } from '@playwright/test';

test('authoritative Mail gaps stay absent on revisits and an OPFS reload', async ({
  page,
}) => {
  const scope = `mail-reconciliation-${crypto.randomUUID()}`;
  await page.goto(`/mail-reconciliation.html?scope=${scope}`);
  const rows = page.locator('#rows li');
  await expect(rows).toHaveCount(8);
  await page
    .getByRole('button', { name: 'Apply authoritative Noise page' })
    .click();
  const expected = [20, 16, 8, 6, 4].map(
    (n) =>
      `GraphqlSoupEmailThread:00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
  );
  await expect(rows).toHaveText(expected);
  for (let visit = 0; visit < 3; visit += 1) {
    await page.getByRole('button', { name: 'Drafts', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('DRAFTS');
    await page.getByRole('button', { name: 'Noise', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('INBOX');
    await expect(rows).toHaveText(expected);
  }
  // No reseeding and no socket deletion: persisted projection invalidation
  // must survive closing the old worker's engine and reopening the OPFS file.
  await page.goto('about:blank');
  await page.goto(`/mail-reconciliation.html?scope=${scope}&seed=false`);
  await expect(rows).toHaveText(expected);
});
