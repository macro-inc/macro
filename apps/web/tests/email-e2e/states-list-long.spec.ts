// What a list longer than a page shows at its end: the Load More row, which
// says Loading... and is busy while the next page is on its way, and offers
// Load More again once that page failed; and what Next item says on the last
// thread of a page whose next page fails.

import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { focusedRowId } from './harness/list';
import type { Mail } from './harness/stack';
import { holdOperation } from './harness/states-list';
import { saw } from './ledger/record';

/** More threads than one page of the list holds (100). */
const LONG_LIST = 104;

/** How many threads the email service lists in the inbox, a page at a time. */
async function inboxCount(mailbox: Mailbox): Promise<number> {
  let count = 0;
  let cursor = '';
  do {
    const response = await mailbox.api(
      `/email/email/threads/previews/cursor/inbox?limit=100${cursor}`
    );
    const page = (await response.json()) as {
      items?: unknown[];
      next_cursor?: string | null;
    };
    count += page.items?.length ?? 0;
    cursor = page.next_cursor
      ? `&cursor=${encodeURIComponent(page.next_cursor)}`
      : '';
  } while (cursor);
  return count;
}

// Gmail only: the list pages through Macro's own copy of the mailbox,
// whatever the provider.
test.describe('the end of a long list of a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the row at the end of a list longer than a page does
  // not say Loading... (or is not busy, or can be pressed again) while the
  // next page is on its way, or offers no Load More once that page failed.
  test('Load More says Loading... while the next page loads, and Load More once it failed', async ({
    page,
    mailbox,
  }) => {
    test.setTimeout(180_000);
    const notes: Mail[] = Array.from({ length: LONG_LIST }, (_, index) => ({
      from: 'Grace <grace@example.com>',
      subject: `Note ${String(index + 1).padStart(3, '0')}`,
      text: `Body ${index + 1}.`,
    }));
    await mailbox.stack.seed('GMAIL', 'notes@example.com', notes);
    await mailbox.stack.link(mailbox.user, 'GMAIL', 'notes@example.com');
    await expect
      .poll(() => inboxCount(mailbox), { timeout: 120_000 })
      .toBe(LONG_LIST);
    const list = page.getByRole('grid', { name: 'Email' });
    const more = list.getByRole('row').filter({
      has: page.getByRole('button', { name: /^(Load More|Loading\.\.\.)$/ }),
    });
    const button = more.getByRole('button');

    await mailbox.open();
    await expect.poll(() => focusedRowId(page)).toBeDefined();
    const nextPage = await holdOperation(page, 'Soup', (body) =>
      body.includes('"continuation"')
    );
    // The cursor near the end of the list asks for the next page.
    await page.keyboard.press('End');
    await expect.poll(() => nextPage.count()).toBeGreaterThan(0);
    await expect(button).toHaveText('Loading...');
    await expect(button).toBeDisabled();
    await expect(more.getByRole('gridcell')).toHaveAttribute(
      'aria-busy',
      'true'
    );
    saw('STL-024');
    await nextPage.fail();
    await expect(button).toHaveText('Load More');
    await expect(button).toBeEnabled();
    await expect(more.getByRole('gridcell')).toHaveAttribute(
      'aria-busy',
      'false'
    );
  });
});
