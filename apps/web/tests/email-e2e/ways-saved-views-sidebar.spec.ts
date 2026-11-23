// The sidebar's Saved views section beyond its rows: its header folds it,
// Load more views brings the views after the first fifty, Retry loading
// views asks again after a failed load, and a view that no longer exists
// offers the way back to Email. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  listedNames,
  storedNames,
  storeView,
  viewList,
  viewRow,
} from './harness/ways-saved-views';
import { did } from './ledger/record';

const from = 'Grace <grace@example.com>';

for (const provider of PROVIDERS) {
  test.describe(`the Saved views section, with ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the section's header does not fold or unfold its
    // views, the views after the first fifty cannot be reached, or a view
    // that is gone lists other mail or leaves no way back to the inbox.
    test('the header folds the section, Load more brings the rest, and a missing view returns to Email', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      // One more than a page of views, each of the mail about Alpha.
      for (let number = 1; number <= 51; number++) {
        await storeView(mailbox, `View ${number}`, { subject: ['Alpha'] });
      }
      const stored = await storedNames(mailbox);
      expect(stored).toHaveLength(51);
      const last = stored[50];
      const header = page.getByRole('button', {
        name: 'Saved views',
        exact: true,
      });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
      await expect.poll(() => listedNames(page)).toEqual(stored.slice(0, 50));

      await header.click();
      did('AL-701');
      await expect(header).toHaveAttribute('aria-expanded', 'false');
      await expect(viewRow(page, stored[0])).toBeHidden();
      await header.click();
      await expect(header).toHaveAttribute('aria-expanded', 'true');
      await expect(viewRow(page, stored[0])).toBeVisible();

      await expect(viewRow(page, last)).toHaveCount(0);
      await page.getByRole('button', { name: 'Load more views' }).click();
      did('AL-700');
      await expect.poll(() => listedNames(page)).toEqual(stored);
      await expect(
        page.getByRole('button', { name: 'Load more views' })
      ).toHaveCount(0);
      // The view of the second page opens like any other.
      await viewRow(page, last).click();
      await expect(viewRow(page, last)).toHaveAttribute('aria-current', 'page');
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);

      // The same address with the id of a view that does not exist.
      const open = /savedView=([0-9a-f-]{36})/.exec(page.url())?.[1];
      if (!open) throw new Error(`no saved view in ${page.url()}`);
      await page.goto(page.url().replace(open, crypto.randomUUID()));
      await expect(
        page.getByText(
          'This saved view is unavailable or you no longer have access.'
        )
      ).toBeVisible();
      expect(await rowIds(page)).toEqual([]);
      await page.getByRole('button', { name: 'Return to Email' }).click();
      did('AL-119');
      await expect(page).not.toHaveURL(/savedView=/);
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
      await expect(
        page
          .getByRole('navigation', { name: 'Email location' })
          .getByRole('button', { name: 'Inbox' })
      ).toBeVisible();
    });

    // When this fails, a failed load of the saved views leaves the sidebar
    // without them until the page is loaded again: Retry asks for nothing.
    test('Retry loading views lists the views after a load that failed', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
      // The service does not answer for the list of views until asked again
      // by hand, as `list-views.spec.ts` fails the list of mail.
      let asked = 0;
      await page.route(/\/graphql(\?|$)/, async (route) => {
        const sent = route.request().postData() ?? '';
        if (!sent.includes('"operationName":"SavedViews"'))
          return route.fallback();
        asked += 1;
        const clicked = await page.evaluate(() =>
          document.documentElement.hasAttribute(
            'data-test-saved-views-retry-clicked'
          )
        );
        if (!clicked) return route.fulfill({ status: 500, body: '{}' });
        return route.fallback();
      });
      const retry = page.getByRole('button', { name: 'Retry loading views' });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
      await expect(retry).toBeVisible();
      await expect(viewList(page).getByRole('button')).toHaveCount(0);

      // Recover only after a real click, so an unrelated automatic re-read
      // cannot satisfy Retry's request-and-recovery assertions.
      await retry.evaluate((button) => {
        button.addEventListener(
          'click',
          () => {
            document.documentElement.setAttribute(
              'data-test-saved-views-retry-clicked',
              ''
            );
          },
          { capture: true, once: true }
        );
      });
      const before = asked;
      await retry.click();
      did('AL-120');
      await expect.poll(() => asked, { timeout: 3_000 }).toBe(before + 1);
      await expect(viewRow(page, 'Alpha mail')).toBeVisible();
      await expect(retry).toHaveCount(0);
      await viewRow(page, 'Alpha mail').click();
      await expect(viewRow(page, 'Alpha mail')).toHaveAttribute(
        'aria-current',
        'page'
      );
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
    });
  });
}
