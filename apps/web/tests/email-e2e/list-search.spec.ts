// Searching mail from the list: the / key reaches the search field, a query
// too short to search says so, a query with no match says so, and Escape
// leaves the search. Each for a Gmail and an Outlook inbox.
//
// The stack runs no search service, so the page's search request is
// answered here: these tests prove what the list does with the field and
// with an answer, not what the service finds.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

for (const provider of PROVIDERS) {
  test.describe(`searching the mail list of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, / does not reach the search field, a query of two
    // characters is searched or is met with an empty list and no word, a
    // query is not sent to the search, a search without a match looks like an
    // empty inbox, or Escape leaves the list searching.
    test('the list searches from three characters, says when nothing matches, and Escape leaves the search', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      const alpha = await mailbox.synced('Alpha');
      const asked: string[] = [];
      await page.route(/\/dss\/search(\?|$)/, (route) => {
        asked.push(route.request().postData() ?? '');
        return route.fulfill({ json: { results: [], next_cursor: null } });
      });
      const field = page.getByRole('searchbox', { name: 'Search email' });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await page.keyboard.press('/');
      did('AL-013');
      await expect(field).toBeFocused();

      await page.keyboard.type('ze');
      await expect(page.getByText('Keep typing to search')).toBeVisible();
      await expect.poll(() => rowIds(page)).toEqual([]);
      saw('STL-006');
      expect(asked).toEqual([]);

      // Not marked as AL-012: its row needs the search service, and the
      // search is answered here.
      await page.keyboard.type('ppelin');
      await expect(page.getByText('No results for "zeppelin"')).toBeVisible();
      saw('STL-007');
      // The last thing asked is the whole query (a shorter one may have been
      // asked while it was typed).
      await expect.poll(() => asked.at(-1) ?? '').toContain('zeppelin');

      await page.keyboard.press('Escape');
      did('AL-017');
      await expect(page.getByText('No results for "zeppelin"')).toHaveCount(0);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
    });
  });
}
