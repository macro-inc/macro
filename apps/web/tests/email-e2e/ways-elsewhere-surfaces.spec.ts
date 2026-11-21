// Email reached from other surfaces: the mention of a thread in another
// editor, and the calendar's setup status, whose button starts the
// connection that the inbox's state calls for.

import type { Page } from '@playwright/test';
import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/linking';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  disconnectInbox,
  lapseGrant,
  outlookStarts,
} from './harness/ways-elsewhere';
import { did } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** Leaves the inbox's calendar turned off by its owner. */
async function turnCalendarOff(mailbox: Mailbox) {
  await mailbox.stack.sql(
    `INSERT INTO email_link_google_scopes (link_id, calendar_disabled_at)
     VALUES ('${mailbox.inbox.linkId}', now())
     ON CONFLICT (link_id) DO UPDATE SET calendar_disabled_at = now()
     RETURNING link_id`
  );
}

/** The button of the calendar's setup status, which lies over the grid. */
function setupButton(page: Page, name: string) {
  return page
    .getByRole('region', { name: 'Calendar periods' })
    .getByRole('button', { name, exact: true });
}

for (const provider of PROVIDERS) {
  test.describe(`a thread mentioned in another editor, with ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, clicking the mention of an email thread in another
    // editor opens nothing, or something else than the thread it names.
    test('clicking the mention of a thread opens that thread', async ({
      page,
      mailbox,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      await mailbox.deliver({ from, subject: 'Agenda', text: 'Two items.' });
      const lunch = await mailbox.synced('Lunch?');
      const agenda = await mailbox.synced('Agenda');

      // The mention is made by pasting the thread's link (AX-319, covered in
      // elsewhere.spec.ts) into the description of a task.
      await mailbox.open(`/app/mail/${lunch.id}`);
      await expect(page.getByText('Noon?')).toBeVisible();
      await page.evaluate(
        (link) => navigator.clipboard.writeText(link),
        `${mailbox.front.origin}/app/mail/${agenda.id}`
      );
      await page.getByRole('button', { name: 'Create task' }).click();
      const description = page
        .getByRole('dialog')
        .locator('[contenteditable="true"]')
        .last();
      await description.click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('ControlOrMeta+v');
      const mention = description.getByRole('link', { name: 'Agenda' });
      await expect(mention).toBeVisible();
      await expect(page.getByText('Two items.')).toHaveCount(0);

      await mention.click();
      did('AX-059');
      await expect(page).toHaveURL(new RegExp(`/mail/${agenda.id}$`));
      await expect(page.getByText('Two items.')).toBeVisible();
    });
  });
}

test.describe('the calendar setup status, with a Gmail inbox', () => {
  // When this fails, the button the calendar shows over an empty grid does
  // not start the connection its state calls for: nothing is asked of the
  // provider, calendar access is asked for a second inbox instead of the one
  // that lacks it, or a reconnection leaves the mail permission out.
  test('each state of the setup status starts the connection it names', async ({
    page,
    mailbox,
    auth,
  }) => {
    const linkId = mailbox.inbox.linkId;
    const ways = [
      // A connected inbox that never granted its calendar.
      {
        button: 'Grant access',
        arrange: async () => {},
        asks: { scopes: 'calendar', reconnectLinkId: linkId },
      },
      {
        button: 'Turn on',
        arrange: () => turnCalendarOff(mailbox),
        asks: { scopes: 'calendar', reconnectLinkId: linkId },
      },
      {
        button: 'Reconnect',
        arrange: () => lapseGrant(mailbox),
        asks: { scopes: 'gmail_and_calendar', reconnectLinkId: linkId },
      },
      {
        button: 'Connect calendar',
        arrange: () => disconnectInbox(mailbox),
        asks: { scopes: 'gmail_and_calendar', reconnectLinkId: null },
      },
    ];

    for (const [index, way] of ways.entries()) {
      await way.arrange();
      await mailbox.open('/app/calendar');
      await setupButton(page, way.button).click();
      did('AX-061');
      await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
      expect(
        auth.starts.map(({ scopes, reconnectLinkId }) => ({
          scopes,
          reconnectLinkId,
        })),
        way.button
      ).toEqual(ways.slice(0, index + 1).map(({ asks }) => asks));
    }
  });
});

test.describe('the calendar setup status, with an Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });

  // When this fails, Reconnect on the calendar of a lapsed Outlook inbox
  // asks nothing of Microsoft, or not for that inbox with its calendar; or,
  // with no inbox left, "Connect calendar" starts no connection.
  test('Reconnect renews the Outlook inbox with its calendar, and Connect calendar starts a new connection', async ({
    page,
    mailbox,
    auth,
  }) => {
    const outlook = outlookStarts(mailbox);

    await lapseGrant(mailbox);
    await mailbox.open('/app/calendar');
    await setupButton(page, 'Reconnect').click();
    did('AX-061');
    await expect
      .poll(() => outlook)
      .toEqual([
        { scopes: 'mail_and_calendar', reconnectLinkId: mailbox.inbox.linkId },
      ]);

    await disconnectInbox(mailbox);
    await mailbox.open('/app/calendar');
    await setupButton(page, 'Connect calendar').click();
    did('AX-061');
    await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
    expect(
      auth.starts.map(({ scopes, reconnectLinkId }) => ({
        scopes,
        reconnectLinkId,
      }))
    ).toEqual([{ scopes: 'gmail_and_calendar', reconnectLinkId: null }]);
    expect(outlook).toHaveLength(1);
  });
});
