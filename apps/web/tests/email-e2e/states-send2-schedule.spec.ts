// What the composer says when its draft is scheduled: refusing to send it
// as it stands, a cancel or a status check that fails; and what it says
// when its draft, with no newer text of its own, is scheduled, sent or
// deleted from another tab.
//
// Gmail only: scheduling, the draft's lifecycle and these notices are the
// same client code for either provider, and the service schedules and
// sends both the same way.

import type { Page } from '@playwright/test';
import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import {
  deleteElsewhere,
  makeDue,
  returnToTab,
  savedNew,
  savedReply,
  scheduleElsewhere,
  sentFromMacro,
  setScheduledUnconfirmed,
} from './harness/states-send2';
import {
  barButton,
  clock,
  morningIn,
  openPicker,
  preset,
  scheduled,
  scheduledClock,
  scheduledNotice,
} from './harness/ways-send';
import { did, saw } from './ledger/record';

const GONE = 'This draft is no longer available.';

/** Opens the message with this subject from the Scheduled tab. */
async function openScheduled(page: Page, subject: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Scheduled' })
    .click();
  await page.getByRole('main').getByText(subject).click();
}

test.use({ provider: 'GMAIL' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, a scheduled email's composer takes Send from the
// keyboard without saying why it refuses it, a cancel of the schedule the
// service failed passes in silence, or a delivery status check that
// cannot reach the service says nothing.
test('a scheduled email says why it cannot be sent or cancelled as it stands', async ({
  page,
  mailbox,
}) => {
  const subject = 'Quarter close';
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject,
    body: 'Numbers.',
  });
  await openPicker(page, clock(page));
  await preset(page, 'Tomorrow').click();
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();
  await expect(scheduledNotice(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
  const [held] = await scheduled(mailbox);
  await openScheduled(page, subject);
  const cancel = await barButton(page, 'Cancel scheduled send');
  await expect(cancel).toBeEnabled();

  // The editor is read-only while scheduled; the keyboard reaches the
  // composer through its send-time control.
  await scheduledClock(page).focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  did('AC-306', 'F-142');
  await expect(
    notice(
      page,
      /This email is scheduled for .+\. Choose a new time to update it, or cancel the schedule to edit\./
    )
  ).toBeVisible();
  saw('STC-406');

  const refuse = /\/email\/email\/drafts\/scheduled\//;
  await page.route(refuse, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, body: 'unavailable' })
      : route.fallback()
  );
  await cancel.click();
  did('AC-052');
  await expect(notice(page, 'Failed to cancel schedule')).toBeVisible();
  await expect(cancel).toBeVisible();
  saw('STC-069');
  await page.unroute(refuse);

  // The sweep began delivering it and could not learn the outcome.
  await setScheduledUnconfirmed(mailbox, held.db_id);
  await openScheduled(page, subject);
  const check = await barButton(page, 'Check delivery status');
  await expect(check).toBeEnabled();
  await page.route(/\/email\/email\/threads\/[0-9a-f-]{36}\?/, (route) =>
    route.abort('connectionfailed')
  );
  await check.click();
  did('AC-054');
  await expect(
    notice(
      page,
      'Could not check delivery status. Try again when you have service.'
    )
  ).toBeVisible();
  saw('STC-071');
});

// When this fails, an open draft scheduled from another tab does not say
// so, its delivery passes without "Scheduled email sent", or a reply whose
// draft was deleted elsewhere stays open as if it still existed.
test('an open draft follows what another tab does to it', async ({
  page,
  mailbox,
}) => {
  const first = await savedNew(page, mailbox, 'Quarter close');
  await scheduleElsewhere(mailbox, first, morningIn(1));
  await returnToTab(page);
  await expect(
    notice(page, /Email scheduled for .+\. Cancel the schedule to edit\./)
  ).toBeVisible();
  saw('STC-072', 'F-142');

  await makeDue(mailbox, first);
  await mailbox.stack.runScheduledSweep();
  await expect.poll(() => sentFromMacro(mailbox, 'Quarter close')).toBe(true);
  await returnToTab(page);
  await expect(notice(page, 'Scheduled email sent')).toBeVisible();
  saw('STC-075');

  // A reply's thread outlives its draft. A new email's draft takes its
  // thread with it, and the composer never learns it is gone (handoff
  // deleted-draft-open-elsewhere-stays-editable).
  const { draftId } = await savedReply(page, mailbox, 'Spare numbers');
  await deleteElsewhere(mailbox, draftId);
  await returnToTab(page);
  await expect(notice(page, GONE)).toBeVisible();
  saw('STC-412');
});
