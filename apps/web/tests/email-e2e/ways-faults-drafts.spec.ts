// A composer's Retry once a draft it could not read can be read again: a
// new message reopened from Drafts and after a reload, and a reply reopened
// in its thread and after a reload; and its Retry once the app's local
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
  subjectField,
  unreadable,
  waitingNotice,
} from './harness/ways-faults';
import { did, saw } from './ledger/record';

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

    // When this fails, the composer's Retry, offered once the app's local
    // cache could not start for a while, does not start it again once it
    // can, or the draft is lost on the way: the composer opens without its
    // subject or text, or an edit made meanwhile stays on this device and
    // never reaches the mailbox.
    test('Retry recovers local storage and keeps the draft', async ({
      page,
      mailbox,
    }) => {
      test.setTimeout(240_000);
      await savedNew(page, mailbox, 'Quarterly numbers');
      const fault = await cacheWorkerUnloadable(page);
      await page.reload();
      await expect(subjectField(page)).toHaveValue('Quarterly numbers');
      await expect(body(page)).toHaveText('The numbers are in.');

      // The edit waits on this device. The worker's failure to load tells
      // the page at once, and the composer says so once storage has been
      // restarting for 15 seconds.
      await body(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' Final.');
      const notice = waitingNotice(page);
      await expect(notice).toContainText(
        'Changes stay on this device until draft synchronization resumes.',
        { timeout: 90_000 }
      );
      saw('STC-434');

      // Retry shows only between the cache's own attempts, which are seconds
      // apart by now, and starts one at once: the worker loads within
      // seconds of the press, before the cache's next attempt of its own.
      // Lifted during one of those, the fault would let it bring storage
      // back by itself, and Retry would not show again.
      const retry = notice.getByRole('button', { name: 'Retry', exact: true });
      await expect(retry).toBeVisible({ timeout: 90_000 });
      fault.lift();
      const loads = fault.loads();
      await retry.click({ timeout: 5_000 });
      did('AC-064');
      await expect.poll(fault.loads, { timeout: 3_000 }).toBeGreaterThan(loads);
      await expect(notice).toHaveCount(0);
      await expect(body(page)).toHaveText('The numbers are in. Final.');
      await expect
        .poll(() =>
          savedDraft(mailbox, { subject: 'Quarterly numbers' }, 'Final.')
        )
        .toBeTruthy();
    });
  });
}
