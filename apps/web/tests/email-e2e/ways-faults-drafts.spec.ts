// A composer's Retry once a draft it could not read can be read again: a
// new message reopened from Drafts and after a reload, and a reply reopened
// in its thread and after a reload; and its Reload once the app's local
// cache, which could not start, can start again. For a Gmail and an Outlook
// inbox.
//
// The faults are the page's own, lifted before the press: every read of the
// drafts this browser keeps fails (`draftStorage().failReads`), or the
// cache's worker cannot load (`cacheWorkerUnloadable`).

import { body, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { draftStorage } from './harness/states-send1';
import {
  replyBody,
  savedDraft,
  savedNew,
  savedReply,
} from './harness/states-send2';
import {
  cacheWorkerUnloadable,
  emailTab,
  reloadBanner,
  subjectField,
  unreadable,
} from './harness/ways-faults';
import { did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`recovering a draft after a fault on this device, ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Retry in "Unable to load this draft" does not read
    // the draft again once this browser's storage works: the composer stays
    // on the notice, or opens without the draft's subject or text, whether
    // the draft was reopened from Drafts or after a reload.
    test('Retry brings back a new message reopened from Drafts and after a reload', async ({
      page,
      mailbox,
    }) => {
      const storage = await draftStorage(page);
      await savedNew(page, mailbox, 'Quarterly numbers');
      await emailTab(page, 'Drafts').click();
      const row = page.getByRole('main').getByText('Quarterly numbers');
      await expect(row).toBeVisible();
      const notice = unreadable(page, 'Unable to load this draft.');

      await storage.failReads();
      await row.click();
      await expect(notice).toHaveText('Unable to load this draft. Retry');
      await storage.release();
      await notice.getByRole('button', { name: 'Retry' }).click();
      did('AC-063', 'F-116');
      await expect(subjectField(page)).toHaveValue('Quarterly numbers');
      await expect(body(page)).toHaveText('The numbers are in.');

      await storage.failReads();
      await page.reload();
      await expect(notice).toHaveText('Unable to load this draft. Retry');
      await storage.release();
      await notice.getByRole('button', { name: 'Retry' }).click();
      did('AC-063', 'F-118');
      await expect(subjectField(page)).toHaveValue('Quarterly numbers');
      await expect(body(page)).toHaveText('The numbers are in.');
    });

    // When this fails, Retry in "Unable to load local draft" does not read
    // a reply's draft again once this browser's storage works: the thread
    // keeps the notice, or its reply box opens empty, whether the thread was
    // reopened from Inbox or after a reload.
    test('Retry brings back a reply reopened in its thread and after a reload', async ({
      page,
      mailbox,
    }) => {
      const storage = await draftStorage(page);
      await savedReply(page, mailbox, 'Site visit');
      const row = page.getByRole('main').getByText('Site visit').first();
      await emailTab(page, 'Inbox').click();
      await expect(row).toBeVisible();
      const notice = unreadable(page, 'Unable to load local draft.');

      await storage.failReads();
      await row.click();
      await expect(notice).toHaveText('Unable to load local draft. Retry');
      await storage.release();
      await notice.getByRole('button', { name: 'Retry' }).click();
      did('AC-102', 'F-117');
      await expect(replyBody(page)).toContainText('Noted.');

      await storage.failReads();
      await page.reload();
      await expect(notice).toHaveText('Unable to load local draft. Retry');
      await storage.release();
      await notice.getByRole('button', { name: 'Retry' }).click();
      did('AC-102', 'F-118');
      await expect(replyBody(page)).toContainText('Noted.');
    });

    // When this fails, the composer's Reload, offered when the app's local
    // cache could not start, does not reload into a working cache, or the
    // draft is gone after it: the composer opens without its subject or
    // text, or later edits stay on this device and never reach the mailbox.
    test('Reload recovers local storage and keeps the draft', async ({
      page,
      mailbox,
    }) => {
      await savedNew(page, mailbox, 'Quarterly numbers');
      const fault = await cacheWorkerUnloadable(page);
      await page.reload();
      const banner = reloadBanner(page);
      await expect(banner).toContainText(
        'Saved on this device; waiting to sync'
      );
      await expect(body(page)).toHaveText('The numbers are in.');

      await fault.lift();
      const reloaded = page.waitForEvent('load');
      await banner.getByRole('button', { name: 'Reload' }).click();
      did('AC-065');
      await reloaded;
      await expect(subjectField(page)).toHaveValue('Quarterly numbers');
      await expect(body(page)).toHaveText('The numbers are in.');
      await expect(banner).toHaveCount(0);
      await body(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' Final.');
      await expect
        .poll(() =>
          savedDraft(mailbox, { subject: 'Quarterly numbers' }, 'Final.')
        )
        .toBeTruthy();
    });
  });
}
