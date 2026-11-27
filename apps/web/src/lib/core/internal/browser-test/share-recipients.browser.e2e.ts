import { expect, type Page, test } from '@playwright/test';

// Each contact read takes 4 s, so the list can be checked between the start
// of the read for new text and its answer.
const URL = '/?share-recipients&groups=400&dms=50&people=600&latency=4000';

const people = (page: Page) =>
  page.getByRole('option').filter({ hasText: '@' });
const reads = async (page: Page) =>
  Number(await page.getByTestId('reads').textContent());
/** Waits until the read numbered `read` has started and not landed. */
const readPending = async (page: Page, read: number) => {
  await expect(page.getByTestId('reads')).toHaveText(String(read));
  await expect(page.getByTestId('pending-reads')).toHaveText('1');
};
/** The read is still pending after a check, so the check saw that state. */
const stillPending = (page: Page) =>
  expect(page.getByTestId('pending-reads')).toHaveText('1', { timeout: 1 });

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
  // The read for "sar" has started and not landed: these rows were listed
  // for "sa" and still match "sar" as the contact cache matches, letters in
  // order.
  await readPending(page, settled + 1);
  await expect(people(page).first()).toBeVisible({ timeout: 1 });
  for (const row of await people(page).all()) {
    await expect(row).toContainText(/s.*a.*r/i, { timeout: 1 });
  }
  await stillPending(page);

  // Nobody matches "sarq": none of them stays while its read is pending.
  await input.press('q');
  await readPending(page, settled + 2);
  await expect(people(page)).toHaveCount(0, { timeout: 1 });
  await stillPending(page);

  await input.press('Backspace');
  await expect(people(page).first()).toBeVisible({ timeout: 15_000 });
  const first = people(page).first();
  const email = (await first.textContent())?.match(/\S+@\S+/)?.[0];
  await first.click();
  await expect(page.getByTestId('recipients')).toContainText(`macro|${email}`);
});
