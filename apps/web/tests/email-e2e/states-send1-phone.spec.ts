// What the phone's composer shows about a send time: the summary in its
// header for a time chosen, held, proposed anew and being cancelled, the
// clock's names, and the picker's own rows on a phone (Clear time, the held
// or proposed time with its footer, Cancel schedule while the cancel is on
// its way), and the notice that Undo took a schedule back.
//
// Gmail only: these are the composer's own words for a time Macro holds,
// the same code whatever the mailbox; the desktop specs see them on both.

import type { Locator, Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import { hold, scheduleRequest } from './harness/states-send1';
import { backfilled } from './harness/states-send2';
import { openPhoneComposer, phone, phoneBody } from './harness/ways-compose1';
import {
  clock,
  preset,
  scheduled,
  scheduledClock,
  scheduledNotice,
} from './harness/ways-send';
import { saw } from './ledger/record';

/** The header summary's line whose text starts with `start`. */
function summary(page: Page, start: RegExp) {
  return page.getByTestId('schedule-summary-label').filter({ hasText: start });
}

/** Taps a clock and waits for its picker's options. */
async function openPhonePicker(page: Page, trigger: Locator) {
  await trigger.tap();
  await expect(page.getByRole('option').first()).toBeVisible();
}

/** A new message to grace with a subject and a body, given a time tomorrow. */
async function chooseTomorrow(page: Page, subject: string): Promise<void> {
  const field = page.getByRole('combobox').first();
  await field.fill('grace@example.com');
  await field.press('Enter');
  await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await phoneBody(page).tap();
  await page.keyboard.type('Bring a blanket.');
  await openPhonePicker(page, clock(page));
  await preset(page, 'Tomorrow').tap();
}

const TIME = String.raw`[A-Z][a-z]{2} \d+, \d{4}\s+8:00 AM`;

test.describe("the phone composer's send time, Gmail inbox", () => {
  test.use({ ...phone, provider: 'GMAIL' });
  // A phone shows one notice at a time: "Inbox synced", raised when the
  // inbox's first backfill is announced, would take the place of a send's
  // notice within half a second. A page opened after the backfill never
  // hears of it.
  test.beforeEach(async ({ page, mailbox }) => {
    await backfilled(mailbox);
    await loadAppSteadily(page);
  });

  // When this fails, the phone's composer hides a chosen time: its header
  // no longer says when the message will go, its picker no longer offers to
  // clear the time, or Schedule send holds no message.
  test('a time chosen on a phone shows in the header, its picker offers to clear it, and it is held', async ({
    page,
    mailbox,
  }) => {
    await openPhoneComposer(page, mailbox);
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      phone.viewport.width
    );
    await chooseTomorrow(page, 'Picnic later');
    await expect(summary(page, /^Scheduled send: /)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Clear send time', exact: true })
    ).toHaveText('Cancel');
    saw('STC-053');
    const chosen = page.getByRole('button', {
      name: new RegExp(`^Send time set to ${TIME}\\. Open to change it\\.$`),
    });
    await expect(chosen).toBeVisible();
    saw('STC-416');

    await openPhonePicker(page, chosen);
    await expect(
      page.getByRole('button', { name: 'Clear time', exact: true })
    ).toBeVisible();
    saw('STC-422');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);

    await page
      .getByRole('button', { name: 'Schedule send', exact: true })
      .tap();
    await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
  });

  // When this fails, a schedule made on a phone loses its notice or its
  // Undo: the composer the thread view mounts after the schedule takes it
  // for one made elsewhere and its alert takes the notice's place (a phone
  // shows one notice at a time), or Undo says nothing of the schedule it
  // took back.
  test('the notice of a schedule made on a phone stays, and its Undo says the schedule is gone', async ({
    page,
    mailbox,
  }) => {
    await openPhoneComposer(page, mailbox);
    await chooseTomorrow(page, 'Picnic undone');
    await page
      .getByRole('button', { name: 'Schedule send', exact: true })
      .tap();
    await expect(scheduledNotice(page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
    await scheduledNotice(page).getByRole('button', { name: 'Undo' }).tap();
    await expect(notice(page, /^Schedule cancelled\.$/)).toBeVisible();
    saw('STC-065');
    await expect.poll(() => scheduled(mailbox)).toEqual([]);
  });

  // When this fails, a phone user cannot tell where a held message stands:
  // the clock no longer says it can cancel, the picker no longer shows the
  // held or the proposed time with what will happen to it, or Cancel
  // schedule can be pressed again while a cancel is on its way.
  test('the picker of a held message on a phone shows its time, a proposal and a cancel under way', async ({
    page,
    mailbox,
  }) => {
    await openPhoneComposer(page, mailbox);
    await chooseTomorrow(page, 'Picnic held');
    await page
      .getByRole('button', { name: 'Schedule send', exact: true })
      .tap();
    await expect(scheduledNotice(page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);

    const held = summary(page, /^Scheduled for [A-Z][a-z]{2} \d+ at 8:00 AM/);
    await expect(held).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel scheduled send', exact: true })
    ).toHaveText('Cancel');
    saw('STC-054');
    const heldClock = page.getByRole('button', {
      name: new RegExp(
        `^Scheduled for ${TIME}\\. Open to propose a new time or cancel the schedule\\.$`
      ),
    });
    await expect(heldClock).toBeVisible();
    saw('STC-417');

    await openPhonePicker(page, heldClock);
    await expect(page.getByText('Scheduled:', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Cancel the schedule before editing the message.')
    ).toBeVisible();
    const cancel = page.getByRole('button', {
      name: 'Cancel schedule',
      exact: true,
    });
    await expect(cancel).toBeEnabled();
    saw('STC-419');

    // A new time waits for Update; the held one stays until then.
    await preset(page, 'In 2 days').tap();
    await expect(
      summary(
        page,
        /^Scheduled for .*Update to .*; original remains active until Update succeeds$/
      )
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel schedule change', exact: true })
    ).toHaveText('Cancel change');
    saw('STC-055');
    const proposed = page.getByRole('button', {
      name: new RegExp(
        `^Proposed send time ${TIME}\\. The email remains scheduled for ${TIME} until you choose Update schedule\\.$`
      ),
    });
    await expect(proposed).toBeVisible();
    saw('STC-418');
    await openPhonePicker(page, proposed);
    await expect(page.getByText('Proposed:', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'The original schedule stays active until Update schedule succeeds.'
      )
    ).toBeVisible();
    const discard = page.getByRole('button', {
      name: 'Discard proposed time',
      exact: true,
    });
    await expect(discard).toBeVisible();
    saw('STC-420');
    await discard.tap();
    await expect(held).not.toContainText('Update to');

    // While the cancel is on its way, the picker says so and takes no second.
    await page.keyboard.press('Escape');
    await openPhonePicker(page, scheduledClock(page));
    const unschedule = await hold(page, scheduleRequest('DELETE'));
    await cancel.tap();
    await unschedule.arrived;
    const cancelling = page.getByRole('button', {
      name: 'Cancelling schedule…',
      exact: true,
    });
    await expect(cancelling).toBeDisabled();
    saw('STC-421');
    await unschedule.release();
    await expect(
      notice(page, 'Schedule cancelled. This email is editable again.')
    ).toBeVisible();
    await expect.poll(() => scheduled(mailbox)).toEqual([]);
  });
});
