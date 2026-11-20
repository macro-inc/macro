// What surfaces outside the mail view show of the inbox: the calendar's
// setup status in each state the inbox's calendar can be in, Home's
// invitation to connect email once no inbox is left, and the threads and
// unsent drafts the phone's search lists. Each for a Gmail and an Outlook
// inbox.

import { devices } from '@playwright/test';
import type { Mailbox } from './harness/fixtures';
import { trashFolder } from './harness/journeys';
import { expect, test } from './harness/linking';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import {
  calendarPeriods,
  holdDraftSaves,
  openPhoneSearch,
  phoneSearchField,
  phoneSearchResults,
  turnCalendarOff,
} from './harness/states-elsewhere';
import { sheetIn } from './harness/states-organise';
import { phoneBody } from './harness/ways-compose1';
import { disconnectInbox, lapseGrant } from './harness/ways-elsewhere';
import { deliverAll, held } from './harness/ways-organise';
import { openedOnPhone, phoneHeaderSubject } from './harness/ways-thread-more';
import { saw } from './ledger/record';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
const from = 'Grace Hopper <grace@example.com>';

type SetupState = {
  title: string;
  description: string;
  action: string;
  arrange: (mailbox: Mailbox) => Promise<void>;
};

const PERMISSION: SetupState = {
  title: 'Enable calendar',
  description: 'Grant calendar access to show your events in Macro.',
  action: 'Grant access',
  // A Gmail inbox the stack links grants its mailbox alone.
  arrange: async () => {},
};
const DISABLED: SetupState = {
  title: 'Calendar is off',
  description: 'Grant calendar access again to show your events in Macro.',
  action: 'Turn on',
  arrange: turnCalendarOff,
};
const REAUTH: SetupState = {
  title: 'Reconnect calendar',
  description: 'Reconnect your account to resume calendar sync.',
  action: 'Reconnect',
  arrange: lapseGrant,
};
const CONNECT: SetupState = {
  title: 'Connect your calendar',
  description:
    'Connect a Google or Microsoft account to show your calendar events.',
  action: 'Connect calendar',
  arrange: disconnectInbox,
};

// An Outlook inbox's calendar comes with its mailbox and has no Google
// scopes to turn off, so it can only lapse or go with the inbox.
const SETUP_STATES = {
  GMAIL: [PERMISSION, DISABLED, REAUTH, CONNECT],
  OUTLOOK: [REAUTH, CONNECT],
} as const;

for (const provider of PROVIDERS) {
  test.describe(`the calendar setup status and Home, with ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, a calendar with no events no longer says why it is
    // empty: the setup status over the grid is gone, or names another state
    // than the inbox is in (a lapsed grant read as a calendar never granted);
    // or Home, with no inbox left, no longer invites to connect email.
    test('the calendar says what its setup lacks as the inbox loses its calendar, and Home asks to connect email once no inbox is left', async ({
      page,
      mailbox,
    }) => {
      const grid = calendarPeriods(page);
      for (const state of SETUP_STATES[provider]) {
        await state.arrange(mailbox);
        await mailbox.open('/app/calendar');
        await expect(
          grid.getByText(state.title, { exact: true })
        ).toBeVisible();
        await expect(grid.getByText(state.description)).toBeVisible();
        await expect(
          grid.getByRole('button', { name: state.action, exact: true })
        ).toBeVisible();
        saw('STX-316');
      }

      // Home is reached from the calendar as a user goes there.
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Home', exact: true })
        .click();
      const home = page.getByRole('grid', { name: 'Home' });
      await expect(
        home.getByRole('heading', { name: 'Welcome home' })
      ).toBeVisible();
      await expect(
        home.getByText(
          'Your recent work and notifications will appear here. Connect email to include your inbox, too.'
        )
      ).toBeVisible();
      await expect(
        home.getByRole('button', { name: 'Connect email' })
      ).toBeVisible();
      saw('STX-311');
    });
  });

  test.describe(`email in the phone's search, with ${anInbox(provider)}`, () => {
    test.use({ ...phone, provider });

    // When this fails, the phone's search no longer finds email: a synced
    // thread is not listed by its subject or by its sender's name, or a
    // draft still on this device is missing until the service has it.
    // (The desktop's Command K leaves email out, and its mention menu finds
    // threads through the search service, which the stack does not run.)
    test("the phone's search lists a thread by its subject and its sender, and a draft not yet saved", async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from,
        subject: 'Quarterly numbers',
        text: 'Here.',
      });
      await mailbox.synced('Quarterly numbers');
      const results = phoneSearchResults(page);
      const field = phoneSearchField(page);
      const thread = results.getByRole('button', { name: 'Quarterly numbers' });

      await mailbox.open('/app/mail');
      await expect(page.getByText('Quarterly numbers').first()).toBeVisible();
      await openPhoneSearch(page);
      await field.fill('Quarterly');
      await expect(thread).toBeVisible();
      await field.fill('Grace');
      await expect(thread).toBeVisible();
      saw('STX-314');
      // Nothing yet answers to the draft's subject.
      await field.fill('Picnic');
      await expect(results.getByRole('button')).toHaveCount(0);

      // The draft's saves never reach the service.
      const held = await holdDraftSaves(page);
      await page.getByRole('button', { name: 'Close search' }).click();
      await page.getByRole('button', { name: 'Email', exact: true }).tap();
      await page.getByRole('button', { name: 'New email' }).tap();
      await page.getByRole('textbox', { name: 'Subject' }).fill('Picnic plan');
      await phoneBody(page).click();
      await page.keyboard.type('Bring a blanket.');
      await expect.poll(() => held.saves.length).toBeGreaterThan(0);
      // Leaving a draft the service does not have yet asks what to do with it.
      await page.getByRole('button', { name: 'Go Back' }).tap();
      await page
        .getByRole('dialog', { name: 'Draft options' })
        .getByRole('button', { name: 'Save Draft' })
        .tap();
      await openPhoneSearch(page);
      await field.fill('Picnic');
      await expect(
        results.getByRole('button', { name: 'Picnic plan' })
      ).toBeVisible();
      saw('STX-314');
    });

    test('Delete returns to the phone search that opened the thread', async ({
      page,
      mailbox,
    }) => {
      const agenda = 'Project Agenda';
      const minutes = 'Project Minutes';
      const ids = await deliverAll(mailbox, [agenda, minutes]);
      const field = phoneSearchField(page);
      const results = phoneSearchResults(page);
      const other = results.getByRole('button', { name: minutes, exact: true });

      await mailbox.open();
      await openPhoneSearch(page);
      await field.fill('Project');
      await expect(other).toBeVisible();
      const searchUrl = page.url();
      await results.getByRole('button', { name: agenda, exact: true }).tap();
      await expect(page).toHaveURL(openedOnPhone(ids[agenda]));
      await expect(page.getByText(`About ${agenda}.`).first()).toBeVisible();

      await phoneHeaderSubject(page, agenda).tap();
      const sheet = page.getByRole('dialog', { name: 'File actions' });
      await sheetIn(sheet);
      await sheet.getByRole('button', { name: 'Delete', exact: true }).tap();
      await expect(notice(page, 'Moved to Trash')).toBeVisible();
      await expect
        .poll(async () => (await held(mailbox, agenda))?.labels)
        .toContain(trashFolder(provider));
      await expect(page).toHaveURL(searchUrl);
      await expect(field).toHaveValue('Project');
      await expect(other).toBeVisible();
      saw('STL-617', 'F-075');
    });
  });
}
