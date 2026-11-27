import { expect, type Page, test } from '@playwright/test';

// People only: every option is a contact, so no channel row can take a
// contact's place in the list's rendered window.
const URL = '/?share-recipients&groups=0&dms=0&people=600';
const MATCHES_SAR = /s.*a.*r/i;

/** A contact read as the fixture reports it: a first page has no cursor. */
type ContactRead = { query: string; cursor: string | null };
/** A first-page read the test holds: it starts, then lands when answered. */
type HeldRead = {
  started: PromiseWithResolvers<void>;
  answer: PromiseWithResolvers<void>;
};

const people = (page: Page) =>
  page.getByRole('option').filter({ hasText: '@' });
/** Each listed person's name and address, read in one call. */
const listed = (page: Page) => people(page).locator('p').allTextContents();

/** Holds the first-page read of each query until the test answers it; every
 * other read is answered at once. Call before the page loads. */
const holdReads = async (page: Page, queries: string[]) => {
  const held = new Map<string, HeldRead>(
    queries.map((query) => [
      query,
      { started: Promise.withResolvers(), answer: Promise.withResolvers() },
    ])
  );
  await page.exposeFunction('holdContactRead', async (read: ContactRead) => {
    const hold = read.cursor === null ? held.get(read.query) : undefined;
    if (!hold) return;
    hold.started.resolve();
    await hold.answer.promise;
  });
  return (query: string) => {
    const hold = held.get(query);
    if (!hold) throw new Error(`No read held for ${query}`);
    return hold;
  };
};

test('keeps the people still matching typed text listed until its read lands', async ({
  page,
}) => {
  const read = await holdReads(page, ['sar', 'sarq']);
  await page.goto(URL);
  const input = page.getByRole('combobox');
  await input.click();
  await input.fill('sa');
  await expect(people(page).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('pending-reads')).toHaveText('0');
  const forSa = await listed(page);
  const stillMatching = forSa.filter((text) => MATCHES_SAR.test(text));
  expect(stillMatching.length).toBeGreaterThan(1);
  expect(stillMatching.length).toBeLessThan(forSa.length);

  await input.press('r');
  // The read for "sar" has started and is held, so it cannot land during
  // these checks. Only people listed for "sa" who still match "sar" as the
  // contact cache matches (letters in order) are listed, and each listed row
  // above that still matches is listed again: the kept rows keep their order,
  // so dropping the others only moves them up the rendered window.
  await read('sar').started.promise;
  await expect(people(page).first()).toBeVisible();
  const forSar = await listed(page);
  expect(forSar.filter((text) => !MATCHES_SAR.test(text))).toEqual([]);
  expect(forSar).toEqual(expect.arrayContaining(stillMatching));

  // Nobody matches "sarq": none of them stays while its read is held, and
  // the list is still open.
  await input.press('q');
  await read('sarq').started.promise;
  await expect(people(page)).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-expanded', 'true');

  read('sar').answer.resolve();
  read('sarq').answer.resolve();
  await input.press('Backspace');
  await expect(people(page).first()).toBeVisible({ timeout: 15_000 });
  const first = people(page).first();
  const email = (await first.textContent())?.match(/\S+@\S+/)?.[0];
  await first.click();
  await expect(page.getByTestId('recipients')).toContainText(`macro|${email}`);
});
