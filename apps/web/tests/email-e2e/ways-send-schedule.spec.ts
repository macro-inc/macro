// Every way to give a new message a send time: a preset of the clock's
// picker, the picker's calendar, the picker's keyboard keys, and the schedule
// bar's Cancel that takes the time away again.

import type { Page } from '@playwright/test';
import { composeNew, loadAppSteadily, routeDraftId } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { addMailbox, readMailbox } from './harness/journeys';
import { sentMessages } from './harness/send';
import type { Provider } from './harness/stack';
import {
  barButton,
  clock,
  morningIn,
  openPicker,
  PRESET_DAYS,
  preset,
  scheduledNotice,
  scheduledTimes,
} from './harness/ways-send';
import type { ActionId } from './ledger/manifest';
import { confirmed, did, saw } from './ledger/record';

/** A way to choose a time in the open picker, and the time it stands for. */
type Way = {
  row: ActionId;
  subject: string;
  choose: (page: Page) => Promise<Date>;
};

const WAYS: Way[] = [
  {
    row: 'AC-045',
    subject: 'By preset',
    choose: async (page) => {
      await preset(page, 'Tomorrow').click();
      return morningIn(1);
    },
  },
  {
    row: 'AC-047',
    subject: 'By calendar',
    choose: async (page) => {
      await page.getByRole('option', { name: /^Custom date/ }).click();
      // The 15th of next month, at 3:20 in the afternoon. The month arrows
      // have no names: the next one follows the month's own button.
      const month = page.getByRole('button', {
        name: /^[A-Z][a-z]+ \d{4}$/,
      });
      await month.locator('xpath=following-sibling::button[1]').click();
      await page.getByRole('button', { name: '15', exact: true }).click();
      await page.getByRole('textbox', { name: 'Hour' }).fill('3');
      await page.getByRole('textbox', { name: 'Minute' }).fill('20');
      await page.getByRole('button', { name: 'PM', exact: true }).click();
      await page
        .getByRole('button', { name: 'Confirm scheduled time' })
        .click();
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth() + 1, 15, 15, 20);
    },
  },
  {
    row: 'AC-403',
    subject: 'By keyboard',
    choose: async (page) => {
      // Down twice: the second option, taken with Enter. Ctrl+K, the way
      // back up, is a known bug with a test of its own below.
      const options = page.getByRole('option');
      const second = await options.nth(1).innerText();
      const label = Object.keys(PRESET_DAYS).find((name) =>
        second.startsWith(name)
      );
      if (!label) throw new Error(`no known preset in "${second}"`);
      await page.keyboard.press('Control+j');
      await expect(options.nth(0)).toHaveAttribute('data-highlighted');
      await page.keyboard.press('Control+j');
      await expect(options.nth(1)).toHaveAttribute('data-highlighted');
      await page.keyboard.press('Enter');
      return morningIn(PRESET_DAYS[label]);
    },
  },
];

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a send time for a new message in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, one way of choosing a send time (a preset, the
    // calendar, the picker's ctrl+j / ctrl+k) does nothing or schedules the
    // message for another time than the one chosen.
    test('every way to choose a send time holds the message for that time', async ({
      page,
      mailbox,
    }) => {
      const held: string[] = [];
      for (const way of WAYS) {
        await composeNew(page, mailbox, {
          to: 'grace@example.com',
          subject: way.subject,
          body: 'The numbers are in.',
        });
        await openPicker(page, clock(page));
        const chosen = await way.choose(page);
        did(way.row);
        // The picker has closed and the bar shows the time before Send
        // is pressed, as a user sees it.
        await expect(page.getByRole('option')).toHaveCount(0);
        await expect(
          page.getByRole('status').filter({ hasText: /^Scheduled send: / })
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Schedule send', exact: true })
          .click();
        await expect(scheduledNotice(page)).toBeVisible();
        saw('STC-059');
        held.push(chosen.toString());
        held.sort((a, b) => Date.parse(a) - Date.parse(b));
        await expect
          .poll(() => scheduledTimes(mailbox), {
            message: `${way.row} did not hold "${way.subject}" for ${chosen}`,
          })
          .toEqual(held);
        confirmed('F-142');
      }
      expect(await sentMessages(mailbox)).toEqual([]);
    });

    // Where Ctrl is the app's modifier key, Ctrl+K opens the command menu
    // over the picker instead of moving up its options. When this passes,
    // that is fixed: remove the tag.
    test('known bug: picker-ctrl-k-opens-command-menu: ctrl+k moves up the options of the open picker @known-bug', {
      tag: '@known-bug',
    }, async ({ page, mailbox }) => {
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Up again',
        body: 'The numbers are in.',
      });
      await openPicker(page, clock(page));
      const options = page.getByRole('option');
      await page.keyboard.press('Control+j');
      await expect(options.nth(0)).toHaveAttribute('data-highlighted');
      await page.keyboard.press('Control+j');
      await expect(options.nth(1)).toHaveAttribute('data-highlighted');
      await page.keyboard.press('Control+k');
      await expect(options.nth(0)).toHaveAttribute('data-highlighted');
    });

    // When this fails, the schedule bar's Cancel does not take a chosen
    // time away: the message is still held for later, or cannot be sent now.
    test('a chosen send time cleared from the schedule bar sends the message now', async ({
      page,
      mailbox,
    }) => {
      const grace = await addMailbox(mailbox, 'grace@example.com');
      await composeNew(page, mailbox, {
        to: grace,
        subject: 'Not later after all',
        body: 'The numbers are in.',
      });
      await routeDraftId(page);
      await openPicker(page, clock(page));
      await preset(page, 'Tomorrow').click();
      await expect(
        page.getByRole('status').filter({ hasText: /^Scheduled send: / })
      ).toBeVisible();
      saw('STC-053');
      await expect(
        page.getByRole('button', { name: 'Schedule send', exact: true })
      ).toBeVisible();

      await (await barButton(page, 'Clear send time')).click();
      did('AC-048');
      await expect(
        page.getByRole('button', { name: 'Schedule send', exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Choose send time' })
      ).toBeVisible();
      await page.getByRole('button', { name: 'Send email' }).click();

      // It went out at once and nothing is held for later.
      await expect
        .poll(
          async () =>
            (await readMailbox(mailbox, grace)).map(
              (message) => message.subject
            ),
          { timeout: 60_000 }
        )
        .toEqual(['Not later after all']);
      expect(await scheduledTimes(mailbox)).toEqual([]);
      confirmed('F-142');
    });
  });
}
