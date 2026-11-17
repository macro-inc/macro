// Search as the search service answers it, on the local stack: mail that
// arrived is indexed, the list's search and the global Search find it by a
// word of its text, and a result opens its thread.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** The ids of the threads the search service finds for what the app asked. */
async function found(mailbox: Mailbox, asked: string): Promise<string[]> {
  const answer = await mailbox.api('/dss/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: asked,
  });
  expect(answer.status).toBe(200);
  const body = (await answer.json()) as {
    results: { type: string; thread_id?: string }[];
  };
  return body.results.flatMap((each) =>
    each.type === 'email' && each.thread_id ? [each.thread_id] : []
  );
}

/** Two threads, one of them about a zeppelin, and the app's list. */
async function twoThreads(mailbox: Mailbox) {
  await mailbox.deliver({
    from,
    subject: 'Timetable',
    text: 'The zeppelin leaves at nine.',
  });
  await mailbox.deliver({
    from,
    subject: 'Lunch?',
    text: 'Noon at the quarry?',
  });
  const zeppelin = await mailbox.synced('Timetable');
  const lunch = await mailbox.synced('Lunch?');
  return { zeppelin, lunch };
}

/** Types a query and answers the search request the app made for it. */
async function search(page: Page, type: () => Promise<void>): Promise<string> {
  const [request] = await Promise.all([
    page.waitForRequest(
      (each) =>
        /\/dss\/search(\?|$)/.test(each.url()) &&
        (each.postData() ?? '').includes('zeppelin')
    ),
    type(),
  ]);
  return request.postData() ?? '';
}

for (const provider of PROVIDERS) {
  test.describe(`searching the mail of ${anInbox(provider)}`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, mail is not indexed for search, or the list does not
    // show what the search service found for the query.
    test('the list shows the threads whose text has the word searched', async ({
      page,
      mailbox,
    }) => {
      const { zeppelin, lunch } = await twoThreads(mailbox);
      const field = page.getByRole('searchbox', { name: 'Search email' });
      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).sort())
        .toEqual([zeppelin.id, lunch.id].sort());

      await page.keyboard.press('ControlOrMeta+f');
      did('AL-015');
      await expect(field).toBeFocused();
      const asked = await search(page, () => page.keyboard.type('zeppelin'));
      did('AL-012');
      // Indexing follows the sync: the service finds the thread a little
      // after the list has it.
      await expect
        .poll(() => found(mailbox, asked), { timeout: 90_000 })
        .toEqual([zeppelin.id]);
      confirmed('F-050');

      // Asked again now that the index has it, by another word of the
      // message: the app keeps an answer for some minutes, and the first
      // one may have come before the index had the thread.
      await field.fill('');
      await page.keyboard.type('leaves');
      await expect.poll(() => rowIds(page)).toEqual([zeppelin.id]);
      saw('STL-987');

      await field.fill('');
      await page.keyboard.type('dirigible');
      await expect(page.getByText('No results for "dirigible"')).toBeVisible();
      saw('STL-007');
    });

    // When this fails, the global Search does not list mail the search
    // service found, or a result does not open its thread.
    test('the global Search lists the thread and opens it', async ({
      page,
      mailbox,
    }) => {
      const { zeppelin } = await twoThreads(mailbox);
      await mailbox.open('/app/search');
      const field = page.getByRole('textbox', { name: 'Search' });
      await field.click();
      const asked = await search(page, async () => {
        await page.keyboard.type('zeppelin');
        await page.keyboard.press('Enter');
      });
      await expect
        .poll(() => found(mailbox, asked), { timeout: 90_000 })
        .toContain(zeppelin.id);
      confirmed('F-051');

      // Asked again now that the index has it.
      await page.getByRole('button', { name: 'Clear search' }).click();
      await expect(field).toHaveText('');
      await field.click();
      await page.keyboard.type('zeppelin');
      await page.keyboard.press('Enter');
      const hit = page.getByText('The zeppelin leaves at nine.').first();
      await expect(hit).toBeVisible();
      await expect(page.getByText('Timetable').first()).toBeVisible();
      saw('STX-968');

      await hit.click();
      did('AX-056', 'F-051');
      await expect(
        page.getByRole('heading', { name: 'Timetable' }).first()
      ).toBeVisible();
      saw('STX-969');
    });
  });
}
