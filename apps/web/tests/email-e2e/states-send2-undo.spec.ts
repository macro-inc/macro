// What Undo of a reply says about a newer reply to the same message: kept,
// and the earlier one not reopened over it, only when there is a newer
// reply.
//
// Gmail only: the reply composer decides this itself, the same for either
// provider.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import { replyBody } from './harness/states-send2';
import { replyTo, textOf } from './harness/ways-compose2';
import {
  clock,
  openPicker,
  preset,
  scheduledNotice,
} from './harness/ways-send';
import { did, saw } from './ledger/record';

const KEPT = 'Your newer reply was kept. The earlier message was not reopened.';

test.use({ provider: 'GMAIL' });
// The service holds a send this long before it delivers it, so Undo is on
// offer for as long as the test needs.
test.use({ stackEnv: { SENT_UNDO_DELAY_SECS: '45' } });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, Undo of a reply loses a newer reply being written to the
// same message without a word (handoff undo-send-refuses-newer-reply): the
// service refuses the newer reply's first save after the Undo, and nothing
// says it was kept.
test('known bug: undo-send-refuses-newer-reply: undo of a reply keeps a newer reply being written and says so @known-bug', {
  tag: '@known-bug',
}, async ({ page, mailbox }) => {
  const subject = 'Lunch plan';
  await replyTo(page, mailbox, subject);
  await replyBody(page).click();
  await page.keyboard.type('Noted.');
  await page.getByRole('button', { name: 'Send email' }).click();
  const sending = notice(page, 'Sending…');
  await expect(sending).toBeVisible();

  // A second reply to the same message, written while the first waits.
  // The message folds once the sent reply is in the thread; it is opened
  // again.
  const message = page
    .locator('main [data-message-body-id]')
    .filter({ hasText: textOf(subject) })
    .first();
  const replyToIt = message.getByRole('button', {
    name: 'Reply',
    exact: true,
  });
  await expect(replyToIt).toHaveCount(0);
  await message.click();
  await message.getByText(textOf(subject)).first().hover();
  await replyToIt.click();
  await replyBody(page).click();
  await page.keyboard.type('Newer.');
  await sending.getByRole('button', { name: 'Undo' }).click();
  did('AC-059');
  await expect(notice(page, KEPT)).toBeVisible();
  saw('STC-077');
  await expect(replyBody(page)).toHaveText('Newer.');
  await expect(
    page.getByText('Draft could not be synced', { exact: true })
  ).toHaveCount(0);
});

// When this fails, Undo of a scheduled reply says a newer reply was kept
// and the earlier message not reopened, while there is no newer reply and
// the composer shows the earlier one, reopened (handoff
// undo-schedule-claims-newer-reply).
test('known bug: undo-schedule-claims-newer-reply: undo of a scheduled reply reopens it without claiming a newer reply @known-bug', {
  tag: '@known-bug',
}, async ({ page, mailbox }) => {
  const subject = 'Dinner plan';
  await replyTo(page, mailbox, subject);
  await replyBody(page).click();
  await page.keyboard.type('Noted.');
  await openPicker(page, clock(page));
  await preset(page, 'Tomorrow').click();
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();
  await expect(scheduledNotice(page)).toBeVisible();
  // Reply again to the same message: it goes to the scheduled reply,
  // which is locked, so what is typed is not written anywhere.
  const message = page
    .locator('main [data-message-body-id]')
    .filter({ hasText: textOf(subject) })
    .first();
  await message.getByText(textOf(subject)).first().hover();
  await message.getByRole('button', { name: 'Reply', exact: true }).click();
  await replyBody(page).click();
  await page.keyboard.type('Newer.');
  await expect(replyBody(page)).toHaveText('Noted.');
  await scheduledNotice(page).getByRole('button', { name: 'Undo' }).click();
  await expect(notice(page, /^Schedule cancelled\.$/)).toBeVisible();
  await expect(replyBody(page)).toHaveText('Noted.');
  // The claim is queued before "Schedule cancelled." is raised and times
  // out like any notice, so it is counted once, now, not waited away.
  expect(await notice(page, KEPT).count()).toBe(0);
});
