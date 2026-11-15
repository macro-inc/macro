// What the composer says when moving a new email's draft to another of the
// user's inboxes (its From) cannot go ahead: the draft written offline is
// not the service's yet, the move failed, an earlier failed move waits for
// its Retry, or the files are too big for the other inbox.

import type { Page } from '@playwright/test';
import {
  attach,
  body,
  composeNew,
  loadAppSteadily,
  relayUploads,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import { subscribeProfessional } from './harness/states-send2';
import { did, saw } from './ledger/record';

const WORK = 'ada.work@example.com';
const HOME = 'ada.home@example.com';

/** Picks `email` in the composer's From menu. */
async function chooseFrom(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: 'From address' }).click();
  await page.getByRole('menuitem').filter({ hasText: email }).click();
}

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });

  // Gmail only: the offline banner and these refusals are the composer's
  // own, made before or instead of the move the service makes for either
  // provider.
  // When this fails, a draft written offline does not say it waits on this
  // device, or is moved to another inbox while the service does not hold it
  // yet; or a failed move does not say why or offer its Retry; or a second
  // move starts while the first waits for its Retry, without a word.
  test('changing the From of a new email says why the move cannot go ahead', async ({
    page,
    context,
    mailbox,
  }) => {
    await subscribeProfessional(mailbox);
    await mailbox.stack.link(mailbox.user, 'GMAIL', WORK);
    await mailbox.stack.link(mailbox.user, 'GMAIL', HOME);
    // Written offline, so the service does not hold the draft yet.
    await mailbox.open('/app/mail/new');
    const to = page.getByRole('combobox').first();
    await expect(body(page)).toBeVisible();
    await expect(to).toBeVisible();
    await context.setOffline(true);
    await to.fill('bob@example.com');
    await to.press('Enter');
    await page.getByPlaceholder(/subject/i).fill('Moving inboxes');
    await body(page).click();
    await page.keyboard.type('Numbers are in.');
    const waiting = page
      .getByRole('status')
      .filter({ hasText: 'Saved on this device; waiting to sync' });
    await expect(waiting).toContainText(
      'Changes stay on this device until you are back online.'
    );
    saw('STC-081');
    await chooseFrom(page, WORK);
    did('AC-020', 'F-100');
    const unsaved = notice(
      page,
      'Reconnect and let the draft finish saving before changing inboxes.'
    );
    await expect(unsaved).toBeVisible();
    saw('STC-408');
    await unsaved.getByRole('button', { name: 'Dismiss' }).click();

    await context.setOffline(false);
    await routeDraftId(page);
    await expect(waiting).toHaveCount(0);
    // Every move fails on its way. The service tells the first check of
    // what became of it that the move never happened; the second check
    // fails too, so that move may have happened and waits for its Retry.
    await page.route('**/email/drafts/*/transfer', (route) =>
      route.fulfill({ status: 500, json: { message: 'try again' } })
    );
    let checks = 0;
    await page.route('**/email/draft-transfers/*/recover', (route) => {
      checks += 1;
      if (checks === 1) return route.fallback();
      return route.fulfill({ status: 503, json: { message: 'unavailable' } });
    });
    await chooseFrom(page, HOME);
    const toHome = notice(
      page,
      'The inbox change did not complete. Your original draft is preserved; you can edit it and try again.'
    );
    const retryHome = toHome.getByRole('button', {
      name: 'Retry inbox change',
    });
    await expect(retryHome).toBeVisible();
    saw('STC-078');

    // The older notice's Retry, for another inbox than the move under way.
    await chooseFrom(page, WORK);
    const toWork = page
      .getByRole('status')
      .filter({ has: page.getByRole('button', { name: 'Retry inbox change' }) })
      .filter({ hasNotText: 'The inbox change did not complete' });
    await expect(toWork).toBeVisible();
    // The newer notice lies over the older one. Put away, it leaves its move
    // pending; the older notice is then on top.
    await toWork.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toWork).toHaveCount(0);
    await retryHome.click();
    did('AC-021', 'F-100');
    await expect(
      notice(
        page,
        'Retry the previous inbox change before choosing another inbox.'
      )
    ).toBeVisible();
    saw('STC-079');
    await expect(
      page.getByRole('button', { name: 'From address' })
    ).toContainText(mailbox.inbox.email);
  });
});

test.describe('an Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });

  // The limit is the destination's: Outlook takes more than Gmail.
  // When this fails, a draft whose files Gmail will not take is moved to a
  // Gmail inbox anyway, or the move fails without saying why.
  test('moving a new email to a Gmail inbox its files are too big for says so', async ({
    page,
    mailbox,
  }) => {
    await mailbox.stack.link(mailbox.user, 'GMAIL', WORK);
    await relayUploads(page);
    await composeNew(page, mailbox, {
      to: 'bob@example.com',
      subject: 'Big numbers',
      body: 'Numbers are in.',
    });
    await routeDraftId(page);
    await attach(page, {
      name: 'numbers.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(19_000_000),
    });
    await expect(
      page.getByRole('button', { name: 'Remove numbers.bin' })
    ).toBeVisible();
    await chooseFrom(page, WORK);
    did('AC-020', 'F-100');
    await expect(
      notice(
        page,
        'These attachments exceed the destination inbox’s size limit.'
      )
    ).toBeVisible();
    saw('STC-407');
    await expect(
      page.getByRole('button', { name: 'From address' })
    ).toContainText(mailbox.inbox.email);
  });
});
