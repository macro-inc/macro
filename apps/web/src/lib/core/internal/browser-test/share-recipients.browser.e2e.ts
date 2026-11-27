import { expect, type Page, test } from '@playwright/test';

const URL = '/?share-recipients&groups=400&dms=50&people=600';

/** A contact read as the fixture reports it: a first page has no cursor. */
type ContactRead = { query: string; cursor: string | null };
/** A first-page read the test holds: it starts, then lands when answered. */
type HeldRead = {
  started: PromiseWithResolvers<void>;
  answer: PromiseWithResolvers<void>;
};

const people = (page: Page) =>
  page.getByRole('option').filter({ hasText: '@' });

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

  await input.press('r');
  // The read for "sar" has started and is held, so it cannot land during
  // these checks: the rows were listed for "sa" and still match "sar" as the
  // contact cache matches, letters in order.
  await read('sar').started.promise;
  await expect(people(page).first()).toBeVisible();
  for (const row of await people(page).all()) {
    await expect(row).toContainText(/s.*a.*r/i);
  }

  // Nobody matches "sarq": none of them stays while its read is held.
  await input.press('q');
  await read('sarq').started.promise;
  await expect(people(page)).toHaveCount(0);

  read('sar').answer.resolve();
  read('sarq').answer.resolve();
  await input.press('Backspace');
  await expect(people(page).first()).toBeVisible({ timeout: 15_000 });
  const first = people(page).first();
  const email = (await first.textContent())?.match(/\S+@\S+/)?.[0];
  await first.click();
  await expect(page.getByTestId('recipients')).toContainText(`macro|${email}`);
});
