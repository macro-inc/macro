// What a desktop composer shows about a send time at each step: the clock's
// tooltip and names, its picker's placeholder, hints and empty result, the
// schedule bar of a time chosen, held, proposed anew and being cancelled,
// and of a message whose delivery has begun or could not be confirmed. Each
// for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import {
  hold,
  scheduleRequest,
  setScheduledDelivery,
} from './harness/states-send1';
import {
  barButton,
  clock,
  openPicker,
  preset,
  scheduled,
  scheduledClock,
  scheduledNotice,
} from './harness/ways-send';
import { saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

/** The schedule bar's line whose text starts with `start`. */
function bar(page: Page, start: string | RegExp) {
  return page.getByTestId('schedule-summary-label').filter({
    hasText: start instanceof RegExp ? start : new RegExp(`^${start}`),
  });
}

/** Schedules a new message for tomorrow and opens it again from Scheduled. */
async function scheduleAndReopen(
  page: Page,
  mailbox: Mailbox,
  subject: string
): Promise<string> {
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject,
    body: 'The numbers are in.',
  });
  await openPicker(page, clock(page));
  await preset(page, 'Tomorrow').click();
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();
  await expect(scheduledNotice(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
  const [held] = await scheduled(mailbox);
  return held.db_id;
}

async function openFromScheduled(page: Page, subject: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Scheduled' })
    .click();
  await page.getByRole('main').getByText(subject).click();
}

for (const provider of PROVIDERS) {
  test.describe(`what the desktop composer says of a send time, ${provider === 'GMAIL' ? 'Gmail' : 'Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the composer no longer tells the user where a send
    // time stands: the clock loses its tooltip or the name that says the
    // time chosen, the picker its placeholder, hint or "no dates" line, or
    // the bar stops saying the time is held, that a new one waits for
    // Update, or that a cancel is under way (and lets Cancel be pressed
    // twice).
    test('the clock, its picker and the bar say where a send time stands', async ({
      page,
      mailbox,
    }) => {
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Board pack',
        body: 'The numbers are in.',
      });
      const trigger = page.getByRole('button', { name: 'Choose send time' });
      await trigger.hover();
      await expect(
        page.getByRole('tooltip').filter({ hasText: 'Schedule send time' })
      ).toBeVisible({ timeout: 15_000 });
      await expect(trigger).toBeVisible();
      saw('STC-050');

      await openPicker(page, trigger);
      const query = page.getByRole('combobox', { name: /./ }).last();
      await expect(query).toHaveAttribute('placeholder', 'Select date');
      await expect(
        page.getByRole('option', { name: /^Custom date\.\.\./ })
      ).toContainText('Pick from calendar');
      await expect(page.getByText('Use queries like')).toBeVisible();
      await expect(page.getByText('tomorrow', { exact: true })).toBeVisible();
      saw('STC-052');

      await query.fill('qqqq');
      await expect(page.getByText('No dates match "qqqq"')).toBeVisible();
      await expect(page.getByRole('option')).toHaveCount(1);
      saw('STC-415');
      await query.fill('');
      await preset(page, 'Tomorrow').click();
      await expect(
        page.getByRole('button', {
          name: /^Send time set to [A-Z][a-z]{2} \d+, \d{4}\s+8:00 AM\. Open to change it\.$/,
        })
      ).toBeVisible();
      saw('STC-416');
      await expect(bar(page, 'Scheduled send: ')).toBeVisible();
      await page
        .getByRole('button', { name: 'Schedule send', exact: true })
        .click();
      await expect(scheduledNotice(page)).toBeVisible({ timeout: 30_000 });

      await openFromScheduled(page, 'Board pack');
      const held = bar(page, /^Scheduled for [A-Z][a-z]{2} \d+ at 8:00 AM/);
      await expect(held).toBeVisible();
      await expect(await barButton(page, 'Cancel scheduled send')).toHaveText(
        'Cancel'
      );
      saw('STC-054');
      await expect(
        page.getByRole('button', {
          name: /^Scheduled for [A-Z][a-z]{2} \d+, \d{4}\s+8:00 AM\. Open to propose a new time\.$/,
        })
      ).toBeVisible();
      saw('STC-417');

      // A new time waits for Update; the held one stays until then.
      await openPicker(page, scheduledClock(page));
      await preset(page, 'In 2 days').click();
      await expect(
        bar(
          page,
          /^Scheduled for .*Update to .*; original remains active until Update succeeds$/
        )
      ).toBeVisible();
      await expect(await barButton(page, 'Cancel schedule change')).toHaveText(
        'Cancel change'
      );
      saw('STC-055');
      await expect(
        page.getByRole('button', {
          name: /^Proposed send time .*\s+8:00 AM\. The email remains scheduled for .*\s+8:00 AM until you choose Update schedule\.$/,
        })
      ).toBeVisible();
      saw('STC-418');
      await (await barButton(page, 'Cancel schedule change')).click();
      await expect(held).not.toContainText('Update to');

      // While the cancel is on its way, the bar says so and takes no second.
      const unschedule = await hold(page, scheduleRequest('DELETE'));
      const cancel = await barButton(page, 'Cancel scheduled send');
      await cancel.click();
      await unschedule.arrived;
      await expect(cancel).toHaveText('Cancelling…');
      await expect(cancel).toBeDisabled();
      saw('STC-058');
      await unschedule.release();
      await expect(
        notice(page, 'Schedule cancelled. This email is editable again.')
      ).toBeVisible();
      await expect(cancel).toHaveCount(0);
      await expect.poll(() => scheduled(mailbox)).toEqual([]);
    });

    // When this fails, a message whose time came is shown as still waiting:
    // the bar no longer says its delivery has begun and cannot be cancelled,
    // or that it may have gone out and will not be sent again, and the user
    // cancels or resends a message that is already on its way.
    test('a held message whose delivery began, then could not be confirmed, says so', async ({
      page,
      mailbox,
    }) => {
      const id = await scheduleAndReopen(page, mailbox, 'Due now');
      await setScheduledDelivery(mailbox, id, 'sending');
      await openFromScheduled(page, 'Due now');
      await expect(bar(page, 'Sending')).toContainText(
        'Delivery has started. Cancellation is no longer available.'
      );
      const check = await barButton(page, 'Check delivery status');
      await expect(check).toHaveText('Check status');
      saw('STC-056');

      await setScheduledDelivery(mailbox, id, 'unconfirmed');
      await check.click();
      await expect(bar(page, 'Delivery unconfirmed')).toContainText(
        'This email may already have been sent. Check Sent. We will not resend automatically.'
      );
      await expect(check).toHaveText('Check status');
      saw('STC-423');
    });
  });
}
