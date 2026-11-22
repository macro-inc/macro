// What Undo of a reply says about a newer reply to the same message: kept,
// and the earlier one not reopened over it, only when there is a newer
// reply.
//
// Gmail only: the reply composer decides this itself, the same for either
// provider.

import { graphqlOperation, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice, threadMessages } from './harness/send';
import { holdOperation, replyBody } from './harness/states-send2';
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

// When this fails, Undo of a reply fails to acknowledge the newer reply, or
// the newer reply fails to save once the service has restored the first one.
test('undo of a reply keeps a newer reply being written and says so', async ({
  page,
  mailbox,
}) => {
  const subject = 'Lunch plan';
  const thread = await replyTo(page, mailbox, subject);
  await replyBody(page).click();
  await page.keyboard.type('Noted.');
  const accepted = page.waitForResponse(
    (response) => graphqlOperation(response.request()) === 'SendEmailMessage'
  );
  await page.getByRole('button', { name: 'Send email' }).click();
  expect(await (await accepted).json()).toMatchObject({
    data: { sendEmailMessage: { attempt: { status: 'ACCEPTED' } } },
  });
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
  const saving = await holdOperation(page, 'SaveEmailDraft');
  await page.keyboard.type('Newer.');
  // Hold the first save until Undo has restored "Noted." on both sides.
  const cancelled = page.waitForResponse(
    (response) => graphqlOperation(response.request()) === 'CancelEmailSend'
  );
  await sending.getByRole('button', { name: 'Undo' }).click();
  did('AC-059');
  expect(await (await cancelled).json()).toMatchObject({
    data: { cancelEmailSend: { attempt: { status: 'CANCELLED' } } },
  });
  await expect(notice(page, 'Send cancelled')).toBeVisible();
  await saving.arrived;
  await saving.release();

  await expect(notice(page, KEPT)).toBeVisible({ timeout: 6_000 });
  saw('STC-077');
  await expect(replyBody(page)).toHaveText('Newer.');
  await expect
    .poll(async () =>
      (await threadMessages(mailbox, thread.id))
        .filter((message) => message.is_draft)
        .map(
          (message) =>
            message.body_html_sanitized?.match(/Newer\.|Noted\./)?.[0]
        )
        .sort()
    )
    .toEqual(['Newer.', 'Noted.']);
  await page.reload();
  await expect(replyBody(page)).toHaveText('Newer.');
});

test('undo of a scheduled reply reopens it without claiming a newer reply', async ({
  page,
  mailbox,
}) => {
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
  await expect(replyBody(page)).not.toBeEditable();
  await scheduledNotice(page).getByRole('button', { name: 'Undo' }).click();
  did('AC-055');
  await expect(notice(page, /^Schedule cancelled\.$/)).toBeVisible();
  saw('STC-065');
  await expect(replyBody(page)).toBeEditable();
  await expect(replyBody(page)).toHaveText('Noted.');
  // The restore callback is queued before the cancellation notice. Check for
  // the false claim while it would still be visible.
  expect(await notice(page, KEPT).count()).toBe(0);
});
