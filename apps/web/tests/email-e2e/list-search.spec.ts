// Searching mail from the list: Ctrl+F reaches the search field, a query of
// any length is searched, a query with no match says so, Escape leaves the
// field with the search kept, and Escape again, in the list, leaves the
// search. Each for a Gmail and an Outlook inbox. And Back, with the
// keyboard still in the field, leaves Mail for the view before it: Gmail
// only, since the field is the same for either provider.
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

    // When this fails, Ctrl+F does not reach the search field, a query of two
    // characters is not searched, a query is not sent to the search, a search
    // without a match looks like an empty inbox, Escape in the field drops
    // the search or keeps the keyboard, or Escape in the list leaves it
    // searching.
    test('the list searches what is typed, says when nothing matches, and Escape leaves the search', async ({
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
      // `/` opens the app's Search view from Email, as from every other view.
      await page.keyboard.press('ControlOrMeta+f');
      did('AL-015');
      await expect(field).toBeFocused();

      await page.keyboard.type('ze');
      await expect(page.getByText('No results for "ze"')).toBeVisible();
      await expect.poll(() => rowIds(page)).toEqual([]);
      await expect.poll(() => asked.at(-1) ?? '').toContain('"ze"');

      // Not marked as AL-012: its row needs the search service, and the
      // search is answered here.
      await page.keyboard.type('ppelin');
      await expect(page.getByText('No results for "zeppelin"')).toBeVisible();
      saw('STL-007');
      // The last thing asked is the whole query (a shorter one may have been
      // asked while it was typed).
      await expect.poll(() => asked.at(-1) ?? '').toContain('zeppelin');

      // Escape hands the keyboard to the list and keeps the search on screen.
      await page.keyboard.press('Escape');
      did('AL-017');
      await expect(field).not.toBeFocused();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.activeElement?.hasAttribute('data-split-id') ?? false
          )
        )
        .toBe(true);
      await expect(field).toHaveValue('zeppelin');
      await expect(page.getByText('No results for "zeppelin"')).toBeVisible();

      // Escape again, now in the list, clears the search.
      await page.keyboard.press('Escape');
      await expect(page.getByText('No results for "zeppelin"')).toHaveCount(0);
      await expect(field).toHaveCount(0);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
    });
  });
}

test.describe('leaving a search of a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, leaving Mail while the keyboard is in its search field
  // opens nothing: the address changes, but the view left for stays blank
  // or the app stops on an error.
  test('Back with the keyboard in the search field opens the view before Mail', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
    const alpha = await mailbox.synced('Alpha');
    await page.route(/\/dss\/search(\?|$)/, (route) =>
      route.fulfill({ json: { results: [], next_cursor: null } })
    );
    const field = page.getByRole('searchbox', { name: 'Search email' });
    const tasks = page.getByRole('complementary', { name: 'Tasks navigation' });

    await mailbox.open('/app/tasks');
    await expect(tasks).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('e');
    await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
    await page.keyboard.press('ControlOrMeta+f');
    did('AL-015');
    await page.keyboard.type('ze');
    await expect(page.getByText('No results for "ze"')).toBeVisible();
    saw('STL-007');
    await expect(field).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/tasks/);
    await expect(tasks).toBeVisible();
  });
});
