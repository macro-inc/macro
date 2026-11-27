import { expect, type Page, test } from '@playwright/test';

// Each contact read takes 4 s, so the list can be checked between the start
// of the read for new text and its answer.
const URL = '/?share-recipients&groups=400&dms=50&people=600&latency=4000';

/** The fixture's contact reads started and not yet answered. */
type PendingRead = { id: number; query: string; cursor: string | null };

const people = (page: Page) =>
  page.getByRole('option').filter({ hasText: '@' });
/** The id of the pending first-page read for `query`, if one is pending. */
const pendingFirstPage = async (page: Page, query: string) => {
  const list = await page.getByTestId('pending-read-list').textContent();
  const pending: PendingRead[] = JSON.parse(list || '[]');
  return (
    pending.find((read) => read.query === query && read.cursor === null)?.id ??
    null
  );
};
/** Waits until the first-page read for `query` has started and returns its
 * id; while that same read is still pending after a check, the check saw the
 * list before it landed. */
const readStarted = async (page: Page, query: string) => {
  await expect.poll(() => pendingFirstPage(page, query)).not.toBeNull();
  return pendingFirstPage(page, query);
};

test('keeps the people still matching typed text listed until its read lands', async ({
  page,
}) => {
  await page.goto(URL);
  const input = page.getByRole('combobox');
  await input.click();
  await input.fill('sa');
  await expect(people(page).first()).toBeVisible({ timeout: 15_000 });

  await input.press('r');
  // The read for "sar" has started and not landed: these rows were listed
  // for "sa" and still match "sar" as the contact cache matches, letters in
  // order.
  const sar = await readStarted(page, 'sar');
  await expect(people(page).first()).toBeVisible({ timeout: 1 });
  for (const row of await people(page).all()) {
    await expect(row).toContainText(/s.*a.*r/i, { timeout: 1 });
  }
  expect(await pendingFirstPage(page, 'sar')).toBe(sar);

  // Nobody matches "sarq": none of them stays while its read is pending.
  await input.press('q');
  const sarq = await readStarted(page, 'sarq');
  await expect(people(page)).toHaveCount(0, { timeout: 1 });
  expect(await pendingFirstPage(page, 'sarq')).toBe(sarq);

  await input.press('Backspace');
  await expect(people(page).first()).toBeVisible({ timeout: 15_000 });
  const first = people(page).first();
  const email = (await first.textContent())?.match(/\S+@\S+/)?.[0];
  await first.click();
  await expect(page.getByTestId('recipients')).toContainText(`macro|${email}`);
});
