// What a row's menu does to the sender of a thread: blocked and unblocked
// again from the notice, moved to Noise and back to Signal. Each for a Gmail
// and an Outlook inbox; the email service holds the block list and the
// sender filters.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** The senders the email service answers as blocked in the inbox. */
async function blocked(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/contacts/blocked');
  return ((await response.json()) as { blocked_emails: string[] })
    .blocked_emails;
}

/** The inbox's sender filters: the address and whether it is Signal. */
async function senderFilters(
  mailbox: Mailbox
): Promise<{ address: string | null; signal: boolean }[]> {
  const response = await mailbox.api('/email/email/filters');
  const body = (await response.json()) as {
    filters: { email_address: string | null; is_important: boolean }[];
  };
  return body.filters.map((filter) => ({
    address: filter.email_address,
    signal: filter.is_important,
  }));
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`the sender of a thread in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Block Sender shows its notice and the sender is not
    // blocked in the mailbox, or Undo leaves the sender blocked.
    test('Block Sender blocks the sender, Undo in its notice unblocks', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      await mailbox.deliver({
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'From Friday.',
      });
      await mailbox.synced('Agenda');
      const photos = await mailbox.synced('Team photos');

      await mailbox.open();
      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Block Sender' }).click();
      did('AL-088');
      const queued = notice(page, 'Sender block queued');
      await expect(queued).toContainText('hal@example.com');
      saw('STL-050', 'F-080');
      await expect.poll(() => blocked(mailbox)).toEqual(['hal@example.com']);
      confirmed('F-080');

      await queued.getByRole('button', { name: 'Undo' }).click();
      did('AL-904');
      await expect(notice(page, 'Sender unblock queued')).toBeVisible();
      saw('STL-050', 'F-196');
      await expect.poll(() => blocked(mailbox)).toEqual([]);
      confirmed('F-196');
    });

    // When this fails, Sender → Noise or Sender → Signal shows its notice
    // and saves no filter (or the wrong one), so the sender's mail stays
    // where it was.
    test('Sender → Noise moves the sender to Noise, Sender → Signal back', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      await mailbox.deliver({
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'From Friday.',
      });
      const agenda = await mailbox.synced('Agenda');
      const photos = await mailbox.synced('Team photos');
      const views = page.getByRole('radiogroup', { name: 'Inbox view' });

      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).sort())
        .toEqual([agenda.id, photos.id].sort());
      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sender → Noise' }).click();
      did('AL-087');
      await expect(notice(page, 'Sender marked as Noise')).toContainText(
        'hal@example.com'
      );
      saw('STL-051', 'F-081');
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'hal@example.com', signal: false }]);
      confirmed('F-081');
      // Signal no longer lists the sender's thread; Noise does.
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      await views.getByText('Noise', { exact: true }).click();
      await expect.poll(() => rowIds(page)).toEqual([photos.id]);

      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sender → Signal' }).click();
      did('AL-086');
      await expect(notice(page, 'Sender marked as Signal')).toContainText(
        'hal@example.com'
      );
      saw('STL-051', 'F-081');
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'hal@example.com', signal: true }]);
      confirmed('F-081');
      // Loaded again, Signal lists both threads.
      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).sort())
        .toEqual([agenda.id, photos.id].sort());
    });

    // Sender → Noise takes the thread out of the Signal list at once; the
    // other way the Noise list keeps the row until the app is loaded again.
    test('known bug: sender-to-signal-row-stays-in-noise: Sender → Signal takes the thread out of the Noise list @known-bug', {
      tag: '@known-bug',
    }, async ({ page, mailbox }) => {
      await mailbox.deliver({
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'From Friday.',
      });
      const photos = await mailbox.synced('Team photos');

      await mailbox.open();
      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sender → Noise' }).click();
      await expect.poll(() => rowIds(page)).toEqual([]);
      await page
        .getByRole('radiogroup', { name: 'Inbox view' })
        .getByText('Noise', { exact: true })
        .click();
      await expect.poll(() => rowIds(page)).toEqual([photos.id]);

      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sender → Signal' }).click();
      await expect(notice(page, 'Sender marked as Signal')).toBeVisible();
      await expect.poll(() => rowIds(page)).toEqual([]);
    });
  });
}
