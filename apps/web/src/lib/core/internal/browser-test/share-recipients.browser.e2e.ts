import { expect, type Page, test } from '@playwright/test';

// Each contact read takes 4 s, so a check a second after a keystroke sees the
// list while the read for the new text is still pending.
const URL = '/?share-recipients&groups=400&dms=50&people=600&latency=4000';
const READ_PENDING_MS = 1_000;

const people = (page: Page) =>
  page.getByRole('option').filter({ hasText: '@' });
const reads = async (page: Page) =>
  Number(await page.getByTestId('reads').textContent());

test('keeps the people still matching typed text listed until its read lands', async ({
  page,
}) => {
  await page.goto(URL);
  const input = page.getByRole('combobox');
  await input.click();
  await input.fill('sa');
  await expect(people(page).first()).toBeVisible({ timeout: 15_000 });
  const settled = await reads(page);

  await input.press('r');
  await page.waitForTimeout(READ_PENDING_MS);
  // The read for "sar" has started and not landed: these rows were listed
  // for "sa" and still match "sar" as the contact cache matches, letters in
  // order.
  expect(await reads(page)).toBe(settled + 1);
  await expect(people(page).first()).toBeVisible({ timeout: 1 });
  for (const row of await people(page).all()) {
    await expect(row).toContainText(/s.*a.*r/i);
  }

  // Nobody matches "sarq": none of them stays while its read is pending.
  await input.press('q');
  await page.waitForTimeout(READ_PENDING_MS);
  await expect(people(page)).toHaveCount(0, { timeout: 1 });

  await input.press('Backspace');
  await expect(people(page).first()).toBeVisible({ timeout: 15_000 });
  const first = people(page).first();
  const email = (await first.textContent())?.match(/\S+@\S+/)?.[0];
  await first.click();
  await expect(page.getByTestId('recipients')).toContainText(`macro|${email}`);
});
