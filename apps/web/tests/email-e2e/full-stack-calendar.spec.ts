// The email functions that reach into the calendar, on the local stack: an
// inbox linked together with its calendar, the calendar service syncing that
// calendar from the provider emulator, and the invitation card in a thread
// answering, joining, opening and saving events for real.
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { body, composeNew } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { PROVIDERS } from './harness/providers';
import { threadMessages } from './harness/send';
import type { LinkedInbox } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const TITLE = 'Planning review';

type ProviderEvent = Record<string, unknown>;

type Meeting = {
  /** Grace's address on the mailbox's provider: she organises the meeting. */
  grace: string;
  /** The id that ties the invitation email to the calendar event. */
  uid: string;
  /** The meeting link the provider gave the event. */
  link: string;
};

function emulator(mailbox: Mailbox): string {
  const { gmailUrl, outlookUrl } = mailbox.stack.info;
  return mailbox.inbox.provider === 'GMAIL' ? gmailUrl : outlookUrl;
}

function calendarUrl(mailbox: Mailbox, address: string): string {
  const calendar = mailbox.inbox.provider === 'GMAIL' ? 'primary' : 'default';
  return `${emulator(mailbox)}/_emulator/mailboxes/${encodeURIComponent(address)}/calendars/${calendar}/events`;
}

/** The events on a person's main calendar, as the provider holds them. */
async function providerEvents(
  mailbox: Mailbox,
  address: string
): Promise<ProviderEvent[]> {
  const response = await fetch(calendarUrl(mailbox, address));
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as ProviderEvent[];
}

function titleOf(event: ProviderEvent): string {
  return String(event.summary ?? event.subject ?? '');
}

/** The guests of a provider event, as lowercase addresses with their answers. */
function guestsOf(event: ProviderEvent): { email: string; answer: string }[] {
  const attendees = (event.attendees ?? []) as Record<string, unknown>[];
  return attendees.map((attendee) => {
    const outlook = attendee.emailAddress as { address?: string } | undefined;
    const status = attendee.status as { response?: string } | undefined;
    return {
      email: String(attendee.email ?? outlook?.address ?? '').toLowerCase(),
      answer: String(attendee.responseStatus ?? status?.response ?? ''),
    };
  });
}

/**
 * Who else is invited to each event with the test's title on the mailbox's
 * calendar. The provider may list the mailbox itself as the organizer.
 */
async function guestsOfOwnEvents(mailbox: Mailbox): Promise<string[][]> {
  const own = mailbox.inbox.email.toLowerCase();
  const events = await providerEvents(mailbox, mailbox.inbox.email);
  return events
    .filter((event) => titleOf(event) === TITLE)
    .map((event) =>
      guestsOf(event)
        .map((guest) => guest.email)
        .filter((email) => email !== own)
    );
}

/**
 * Grace puts a meeting with a video link on her calendar and invites the
 * mailbox, the way the provider does it: the mailbox's calendar gets its own
 * copy of the event.
 */
async function meeting(mailbox: Mailbox): Promise<Meeting> {
  const provider = mailbox.inbox.provider;
  const grace = mailbox.stack.address('grace@example.com');
  await mailbox.stack.seed(provider, 'grace@example.com', []);
  const event =
    provider === 'GMAIL'
      ? {
          summary: TITLE,
          description: 'Bring the agenda.',
          start: { dateTime: '2027-01-14T17:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2027-01-14T18:00:00Z', timeZone: 'UTC' },
          attendees: [{ email: mailbox.inbox.email }],
          conferenceData: { createRequest: { requestId: 'planning' } },
        }
      : {
          subject: TITLE,
          body: { contentType: 'text', content: 'Bring the agenda.' },
          start: { dateTime: '2027-01-14T17:00:00', timeZone: 'UTC' },
          end: { dateTime: '2027-01-14T18:00:00', timeZone: 'UTC' },
          attendees: [
            {
              emailAddress: { address: mailbox.inbox.email },
              type: 'required',
            },
          ],
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
        };
  const response = await fetch(calendarUrl(mailbox, grace), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  const [stored] = (await providerEvents(mailbox, grace)).filter(
    (candidate) => titleOf(candidate) === TITLE
  );
  const uid = stored?.iCalUID ?? stored?.iCalUId;
  const online = stored?.onlineMeeting as { joinUrl?: string } | undefined;
  const link = stored?.hangoutLink ?? online?.joinUrl;
  if (typeof uid !== 'string' || typeof link !== 'string') {
    throw new Error(
      `the provider kept no id or meeting link: ${JSON.stringify(stored)}`
    );
  }
  return { grace, uid, link };
}

/** The calendar file an invitation email carries. */
function calendarFile(event: {
  method: 'REQUEST' | 'PUBLISH';
  uid: string;
  organizer: string;
  guest?: string;
}): string {
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Example//Calendar//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method}`,
    'BEGIN:VEVENT',
    'DTSTART:20270114T170000Z',
    'DTEND:20270114T180000Z',
    'DTSTAMP:20261112T120000Z',
    `ORGANIZER;CN=Grace:mailto:${event.organizer}`,
    `UID:${event.uid}`,
    ...(event.guest
      ? [
          `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Ada:mailto:${event.guest}`,
        ]
      : []),
    'DESCRIPTION:Bring the agenda.',
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    `SUMMARY:${TITLE}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Delivers an email carrying a calendar file, the way each provider sends one. */
async function deliverCalendarMail(
  mailbox: Mailbox,
  mail: { from: string; subject: string; method: 'REQUEST' | 'PUBLISH' },
  calendar: string
): Promise<void> {
  const message = {
    from: `Grace <${mail.from}>`,
    subject: mail.subject,
    text: `Grace sent you ${TITLE}.`,
  };
  if (mailbox.inbox.provider === 'GMAIL') {
    await mailbox.deliver({
      ...message,
      attachments: [
        {
          filename: 'invite.ics',
          mimeType: `text/calendar; method=${mail.method}; charset=UTF-8`,
          base64: Buffer.from(calendar).toString('base64'),
        },
      ],
    });
    return;
  }
  const response = await fetch(
    `${mailbox.stack.info.outlookUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...message, calendar }),
    }
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
}

/**
 * Has the calendar service read the mailbox's Outlook calendar now. It reads
 * one every two minutes and nothing the app calls asks for a round sooner, so
 * the test makes its own account's next round due. Google calendars push
 * their changes and need no help.
 */
async function syncCalendarNow(mailbox: Mailbox): Promise<void> {
  if (mailbox.inbox.provider !== 'OUTLOOK') return;
  await mailbox.stack.sql(
    `UPDATE calendar_outlook_work w SET next_run_at = now()
     FROM calendar_accounts a
     WHERE a.id = w.account_id
       AND a.email_link_id = '${mailbox.inbox.linkId}'
       AND w.next_run_at > now()
     RETURNING w.id`
  );
}

/**
 * Waits until the email service has found the invitation in the thread and,
 * when `matched`, tied it to the event on the mailbox's calendar.
 */
async function invitationReady(
  mailbox: Mailbox,
  threadId: string,
  matched: boolean
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await threadMessages(mailbox, threadId)).map(
          (message) =>
            ((message.calendar_invitations as unknown[] | undefined) ?? [])
              .length
        ),
      { timeout: 60_000 }
    )
    .toEqual([1]);
  if (!matched) return;
  await expect
    .poll(
      async () => {
        await syncCalendarNow(mailbox);
        const answer = await mailbox.api(
          `/email/email/threads/${threadId}/calendar-invitations`
        );
        return answer.text();
      },
      { timeout: 60_000 }
    )
    .toContain('"resolved"');
}

/**
 * Waits until the calendar service has read the calendar of the inbox that
 * was linked a moment ago. Until then it has nowhere to put a new event, the
 * app has no calendar to offer, and a change at the provider is not followed
 * yet.
 */
async function calendarReady(
  mailbox: Mailbox,
  inbox: LinkedInbox = mailbox.inbox
): Promise<void> {
  const provider = inbox.provider === 'GMAIL' ? 'google' : 'outlook';
  await expect
    .poll(
      async () =>
        (
          await mailbox.stack.sql<{ sync_status: string }>(
            `SELECT sync_status FROM calendar_accounts
             WHERE email_link_id = '${inbox.linkId}'`
          )
        ).map((account) => account.sync_status),
      { timeout: 60_000 }
    )
    .toEqual(['ready']);
  await expect
    .poll(async () => (await mailbox.api('/calendar/calendars')).text(), {
      timeout: 60_000,
    })
    .toContain(`"provider":"${provider}"`);
}

function invitationCard(page: Page): Locator {
  return page.getByRole('region', { name: `Calendar invitation: ${TITLE}` });
}

/** Delays only the test's new account's first Calendar API discovery. */
async function delayCalendarDiscovery(mailbox: Mailbox, address: string) {
  const faults = `${mailbox.stack.info.gmailUrl}/_emulator/faults`;
  const response = await fetch(faults, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mailbox: address,
      route: 'calendarList.list',
      delay_ms: 25_000,
    }),
  });
  if (!response.ok)
    throw new Error(`discovery delay refused: ${response.status}`);
  const { id } = (await response.json()) as { id: number };
  return () => fetch(`${faults}/${id}`, { method: 'DELETE' });
}

/** Grace's invitation to her meeting, synced and open in the thread. */
async function openInvitation(page: Page, mailbox: Mailbox): Promise<Meeting> {
  await calendarReady(mailbox);
  const invited = await meeting(mailbox);
  await deliverCalendarMail(
    mailbox,
    {
      from: invited.grace,
      subject: `Invitation: ${TITLE}`,
      method: 'REQUEST',
    },
    calendarFile({
      method: 'REQUEST',
      uid: invited.uid,
      organizer: invited.grace,
      guest: mailbox.inbox.email,
    })
  );
  const thread = await mailbox.synced(`Invitation: ${TITLE}`);
  await invitationReady(mailbox, thread.id, true);
  await mailbox.open(`/app/mail/${thread.id}`);
  await expect(invitationCard(page)).toBeVisible();
  return invited;
}

/** The mailbox's answer to the meeting, as Grace's calendar shows it. */
async function answerOnOrganizersCalendar(
  mailbox: Mailbox,
  invited: Meeting
): Promise<string | undefined> {
  const events = await providerEvents(mailbox, invited.grace);
  const event = events.find((candidate) => titleOf(candidate) === TITLE);
  return event
    ? guestsOf(event).find(
        (guest) => guest.email === mailbox.inbox.email.toLowerCase()
      )?.answer
    : undefined;
}

/**
 * Keeps the event composer from asking the extractor (a model) for a time and
 * place: the composer then keeps what the email itself gave it.
 */
async function withoutExtraction(page: Page): Promise<void> {
  await page.route('**/universal_input/**', (route) =>
    route.fulfill({ status: 503, body: 'no extractor in this test' })
  );
}

/** The event composer, once it shows the email's subject and Grace as a guest. */
async function composerFor(page: Page, grace: string): Promise<Locator> {
  const composer = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('textbox', { name: 'Title' }) });
  await expect(composer.getByRole('textbox', { name: 'Title' })).toHaveValue(
    TITLE
  );
  await expect(composer.getByRole('button', { name: 'Guests' })).toContainText(
    grace
  );
  return composer;
}

for (const provider of PROVIDERS) {
  test.describe(`calendar in email on ${provider}`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider, access: 'mail-and-calendar' });

    // When this fails, answering an invitation from the email does not reach
    // the organizer: Ada clicks Yes and Grace's calendar still shows her as
    // not having answered.
    test('answering Yes on an invitation tells the organizer', async ({
      page,
      mailbox,
    }) => {
      const invited = await openInvitation(page, mailbox);
      const card = invitationCard(page);
      const answers = card.getByRole('radiogroup', { name: 'Your response' });
      await expect(answers).toBeVisible();
      await expect(
        card.getByText(`Responding as ${mailbox.inbox.email}`)
      ).toBeVisible();
      saw('STL-517');
      expect(await answerOnOrganizersCalendar(mailbox, invited)).not.toBe(
        'accepted'
      );

      await answers.getByText('Yes', { exact: true }).click();
      did('AL-178');
      await expect(answers.getByRole('radio', { name: 'Yes' })).toBeChecked();
      saw('STL-095');

      await expect
        .poll(() => answerOnOrganizersCalendar(mailbox, invited), {
          timeout: 30_000,
        })
        .toBe('accepted');
      confirmed('F-154');
    });

    // When this fails, the Join button on an invitation opens nothing or the
    // wrong address, so Ada cannot get into the meeting from the email.
    test('Join on an invitation opens the meeting link', async ({
      page,
      mailbox,
    }) => {
      const invited = await openInvitation(page, mailbox);
      // The link belongs to a real meeting host, so the test takes the place
      // of the new tab and reads the address the app asks the browser for.
      const opened = page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            window.open = (url) => {
              resolve(String(url));
              return null;
            };
          })
      );
      await invitationCard(page)
        .getByRole('button', { name: 'Join meeting' })
        .click();
      did('AL-179');
      expect(await opened).toBe(invited.link);
      saw('STL-941');
    });

    // When this fails, Open in calendar on an invitation does not show the
    // event, so Ada cannot see the meeting on her calendar from the email.
    test('Open in calendar on an invitation shows the event', async ({
      page,
      mailbox,
    }) => {
      await openInvitation(page, mailbox);
      await invitationCard(page)
        .getByRole('button', { name: 'Open in calendar' })
        .click();
      did('AL-180');
      await expect(page).toHaveURL(/\/app\/calendar\/.*calendar\.eventId=/);
      const details = page.getByRole('dialog', { name: TITLE });
      await expect(details.getByText('Bring the agenda.')).toBeVisible();
      // The day in this machine's zone, which is the browser's too: the
      // event is at 17:00 UTC.
      const day = new Date('2027-01-14T17:00:00Z').toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
      });
      await expect(details.getByText(day)).toBeVisible();
      saw('STL-941');
    });

    // When this fails, the Create event button on a draft does not make an
    // event: it is not offered when the draft proposes a meeting, the
    // composer opens without the draft's subject and recipient, or saving it
    // puts nothing on Ada's calendar.
    test('Create event on a draft puts the meeting on the calendar', async ({
      page,
      mailbox,
    }) => {
      const grace = mailbox.stack.address('grace@example.com');
      await calendarReady(mailbox);
      await withoutExtraction(page);
      await composeNew(page, mailbox, {
        to: grace,
        subject: TITLE,
        body: 'Can we meet tomorrow at 2pm?',
      });
      const create = page.getByRole('button', { name: 'Create event' });
      await expect(create).toHaveAttribute('data-suggested', '');
      saw('STC-310');

      await create.click();
      did('AC-044');
      const composer = await composerFor(page, grace);
      await composer.getByRole('button', { name: 'Create event' }).click();

      await expect
        .poll(() => guestsOfOwnEvents(mailbox), { timeout: 30_000 })
        .toEqual([[grace.toLowerCase()]]);
      confirmed('F-114');
      await expect(body(page)).toContainText('Can we meet tomorrow at 2pm?');
    });

    // When this fails, pressing b on an open thread does not make an event
    // from it: no composer, a composer without the thread's subject and
    // sender, or an event that never reaches Ada's calendar.
    test('b on a thread makes an event with its sender as guest', async ({
      page,
      mailbox,
    }) => {
      const grace = mailbox.stack.address('grace@example.com');
      await calendarReady(mailbox);
      await withoutExtraction(page);
      await mailbox.deliver({
        from: `Grace <${grace}>`,
        subject: TITLE,
        text: 'Can we meet tomorrow at 2pm?',
      });
      const thread = await mailbox.synced(TITLE);
      await mailbox.open(`/app/mail/${thread.id}`);
      await expect(
        page.getByText('Can we meet tomorrow at 2pm?')
      ).toBeVisible();

      await page.keyboard.press('b');
      did('AL-136');
      const composer = await composerFor(page, grace);
      saw('STL-988');
      await composer.getByRole('button', { name: 'Create event' }).click();

      await expect
        .poll(() => guestsOfOwnEvents(mailbox), { timeout: 30_000 })
        .toEqual([[grace.toLowerCase()]]);
      confirmed('F-114');
    });
  });
}

test.describe('shared events in email on GMAIL', { tag: '@full-stack' }, () => {
  test.use({ provider: 'GMAIL', access: 'mail-and-calendar' });

  // When this fails, Add to calendar on an event someone shared by email does
  // nothing: the event never reaches Ada's Google calendar, with or without
  // the toast saying it did.
  test('Add to calendar saves a shared event to the calendar', async ({
    page,
    mailbox,
  }) => {
    const grace = mailbox.stack.address('grace@example.com');
    await deliverCalendarMail(
      mailbox,
      { from: grace, subject: `Shared: ${TITLE}`, method: 'PUBLISH' },
      calendarFile({
        method: 'PUBLISH',
        uid: `shared-${mailbox.inbox.linkId}@example.com`,
        organizer: grace,
      })
    );
    const thread = await mailbox.synced(`Shared: ${TITLE}`);
    await invitationReady(mailbox, thread.id, false);
    expect(
      (await providerEvents(mailbox, mailbox.inbox.email)).map(titleOf)
    ).not.toContain(TITLE);
    await calendarReady(mailbox);
    await mailbox.open(`/app/mail/${thread.id}`);
    const card = page.getByRole('region', { name: `Shared event: ${TITLE}` });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Add to calendar' }).click();
    did('AL-183');
    await expect(page.getByText('Added to your calendar')).toBeVisible();
    saw('STL-099');

    await expect
      .poll(
        async () =>
          (await providerEvents(mailbox, mailbox.inbox.email)).map(titleOf),
        { timeout: 30_000 }
      )
      .toContain(TITLE);
    confirmed('F-156');
  });
});

test.describe('first calendar sync from email', { tag: '@full-stack' }, () => {
  test.use({ provider: 'GMAIL', access: 'mail', seedGoogleGrant: false });

  test('shared-event actions recover when the first writable calendar arrives', async ({
    page,
    mailbox,
  }) => {
    const grace = mailbox.stack.address('grace@example.com');
    const address = 'calendar@example.com';
    const calendarAddress = mailbox.stack.address(address);
    const revisedTitle = `${TITLE} with notes`;
    const links = await mailbox.api('/email/email/links');
    expect(links.ok).toBe(true);
    expect((await links.json()).links).toContainEqual(
      expect.objectContaining({
        id: mailbox.inbox.linkId,
        needs_calendar_permission: true,
      })
    );
    await withoutExtraction(page);
    await deliverCalendarMail(
      mailbox,
      { from: grace, subject: TITLE, method: 'PUBLISH' },
      calendarFile({
        method: 'PUBLISH',
        uid: `first-calendar-${mailbox.inbox.linkId}@example.com`,
        organizer: grace,
      })
    );
    const thread = await mailbox.synced(TITLE);
    await invitationReady(mailbox, thread.id, false);

    const recording = test.info().outputPath('first-calendar-sync.webm');
    const release = await delayCalendarDiscovery(mailbox, calendarAddress);
    try {
      await page.screencast.start({
        path: recording,
        size: { width: 1280, height: 720 },
      });
      await mailbox.stack.link(
        mailbox.user,
        'GMAIL',
        address,
        'mail-and-calendar'
      );
      await mailbox.open(`/app/mail/${thread.id}`);
      const origin = await page.evaluate(() => performance.timeOrigin);
      const syncing = 'Syncing your calendar…';
      const card = page.getByRole('region', { name: `Shared event: ${TITLE}` });
      const cardSync = card.getByRole('status').filter({ hasText: syncing });
      await expect(cardSync).toBeVisible({ timeout: 15_000 });
      await expect(
        card.getByRole('button', { name: 'Add to calendar' })
      ).toHaveCount(0);
      saw('STL-523');

      await page.keyboard.press('b');
      did('AL-136');
      const composer = await composerFor(page, grace);
      const title = composer.getByRole('textbox', { name: 'Title' });
      await expect(
        composer.getByRole('status').filter({ hasText: syncing })
      ).toBeVisible();
      await expect(
        composer.getByRole('button', { name: 'Calendar', exact: true })
      ).toHaveCount(0);
      await expect(
        composer.getByRole('button', { name: 'Create event' })
      ).toHaveCount(0);
      await title.fill(revisedTitle);
      saw('STL-524');

      // An in-flight discovery returns after its delay. Later requests proceed normally.
      expect((await release()).ok).toBe(true);
      await expect(
        composer.getByRole('button', { name: 'Create event' })
      ).toBeEnabled({ timeout: 60_000 });
      await expect(title).toHaveValue(revisedTitle);
      await composer.getByRole('button', { name: 'Create event' }).click();
      await expect(composer).toHaveCount(0);
      const titles = async () =>
        (await providerEvents(mailbox, calendarAddress)).map(titleOf);
      await expect.poll(titles).toContain(revisedTitle);
      confirmed('F-114');

      await card.getByRole('button', { name: 'Add to calendar' }).click();
      did('AL-183');
      await expect
        .poll(titles)
        .toEqual(expect.arrayContaining([TITLE, revisedTitle]));
      confirmed('F-156');
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    } finally {
      await release();
      await page.screencast.stop();
    }
    // The full-stack workflow only uploads loose recordings on failure.
    await test.info().attach('first-calendar-sync', {
      body: await readFile(recording),
      contentType: 'video/webm',
    });
  });
});

test.describe('shared events in email on OUTLOOK', {
  tag: '@full-stack',
}, () => {
  test.use({ provider: 'OUTLOOK', access: 'mail-and-calendar' });

  /** The card of an event Grace shared by email, in its open thread. */
  async function sharedEvent(page: Page, mailbox: Mailbox): Promise<Locator> {
    const grace = mailbox.stack.address('grace@example.com');
    await deliverCalendarMail(
      mailbox,
      { from: grace, subject: `Shared: ${TITLE}`, method: 'PUBLISH' },
      calendarFile({
        method: 'PUBLISH',
        uid: `shared-${mailbox.inbox.linkId}@example.com`,
        organizer: grace,
      })
    );
    const thread = await mailbox.synced(`Shared: ${TITLE}`);
    await invitationReady(mailbox, thread.id, false);
    await mailbox.open(`/app/mail/${thread.id}`);
    const card = page.getByRole('region', { name: `Shared event: ${TITLE}` });
    await expect(card).toBeVisible();
    return card;
  }

  // When this fails, a shared event in an Outlook inbox can no longer be
  // saved by someone who also has a Google calendar: the button stays
  // disabled, does nothing, or the event never reaches that calendar.
  test('Add to calendar saves a shared event to a Google calendar the user also linked', async ({
    page,
    mailbox,
  }) => {
    const google = await mailbox.stack.link(
      mailbox.user,
      'GMAIL',
      'ada.calendar@example.com',
      'mail-and-calendar'
    );
    await calendarReady(mailbox, google);
    const googleEvents = async () => {
      const response = await fetch(
        `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(google.email)}/calendars/primary/events`
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
      }
      return ((await response.json()) as ProviderEvent[]).map(titleOf);
    };
    expect(await googleEvents()).not.toContain(TITLE);
    const card = await sharedEvent(page, mailbox);

    await card.getByRole('button', { name: 'Add to calendar' }).click();
    did('AL-183');
    await expect(page.getByText('Added to your calendar')).toBeVisible();
    saw('STL-099');

    await expect.poll(googleEvents, { timeout: 30_000 }).toContain(TITLE);
    // Outlook's own calendar takes no copy.
    expect(
      (await providerEvents(mailbox, mailbox.inbox.email)).map(titleOf)
    ).not.toContain(TITLE);
    confirmed('F-156');
  });

  // When this fails, a reader whose only calendar is Outlook's has no way to
  // tell why the shared event cannot be saved directly from the card.
  test('a shared event explains the calendar requirement to an Outlook-only reader', async ({
    page,
    mailbox,
  }) => {
    await calendarReady(mailbox);
    // Check the response as well as the card so a disconnected reader cannot
    // satisfy the test.
    const calendars = page.waitForResponse(
      (response) =>
        (response.request().postData() ?? '').includes(
          '"operationName":"Calendars"'
        ) && response.ok()
    );
    const card = await sharedEvent(page, mailbox);
    expect(await (await calendars).text()).toMatch(/"provider":"outlook"/i);
    await expect(card.getByRole('status')).toHaveText(
      'Adding shared events requires a writable Google calendar.'
    );
    await expect(
      card.getByRole('button', { name: 'Add to calendar' })
    ).toHaveCount(0);
    saw('STL-522');
  });
});

test.describe('a calendar connected after the calendar was opened', {
  tag: '@full-stack',
}, () => {
  test.use({ provider: 'GMAIL' });

  /** Puts an event at local noon today on a Google mailbox's calendar. */
  async function eventToday(
    page: Page,
    mailbox: Mailbox,
    address: string,
    title: string
  ): Promise<void> {
    const start = await page.evaluate(() => {
      const noon = new Date();
      noon.setHours(12, 0, 0, 0);
      return noon.toISOString();
    });
    const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
    const url = `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(address)}/calendars/primary/events`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: title,
        start: { dateTime: start, timeZone: 'UTC' },
        end: { dateTime: end, timeZone: 'UTC' },
      }),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }
  }

  /** Whether Macro holds an event with this title for the test's user. */
  async function stored(mailbox: Mailbox, title: string): Promise<number> {
    const [row] = await mailbox.stack.sql<{ count: number }>(
      `SELECT count(*)::int AS count FROM calendar_events
       WHERE owner_id = '${mailbox.user.macroUserId}' AND title = '${title}'`
    );
    return row?.count ?? 0;
  }

  // When this fails, the days the calendar showed while no inbox was
  // connected stay empty once one is: the local cache keeps them as fetched,
  // and with no inbox tracked it never asks the server what changed.
  test('shows the new calendar on a day it showed before', async ({
    page,
    mailbox,
  }) => {
    const removed = await mailbox.api(
      `/email/email/links/${mailbox.inbox.linkId}`,
      { method: 'DELETE' }
    );
    expect(removed.status).toBe(204);
    // The watermark of each page of occurrences the cache fetched.
    const pages: string[] = [];
    let lastPageAt = 0;
    page.on('response', async (response) => {
      const request = response.request().postData() ?? '';
      if (!request.includes('"operationName":"CalendarOccurrences"')) return;
      lastPageAt = Date.now();
      const text = await response.text().catch(() => '');
      pages.push(/"watermark":(\[[^\]]*\])/.exec(text)?.[1] ?? 'none');
    });
    const days = page.getByRole('region', { name: 'Calendar periods' });
    await mailbox.open('/app/calendar/day');
    await expect(days).toBeVisible();
    // The cache fills a year around today in the background, a month every
    // two seconds; a user connects later than that.
    await expect
      .poll(() => pages.length > 0 && Date.now() - lastPageAt > 6_000, {
        timeout: 120_000,
      })
      .toBe(true);
    expect(new Set(pages)).toEqual(new Set(['[]']));

    const address = mailbox.stack.address('calendar@example.com');
    const run = Date.now().toString(36);
    const before = `Standup ${run}`;
    await mailbox.stack.seed('GMAIL', 'calendar@example.com', []);
    await eventToday(page, mailbox, address, before);
    const inbox = await mailbox.stack.link(
      mailbox.user,
      'GMAIL',
      'calendar@example.com',
      'mail-and-calendar'
    );
    await calendarReady(mailbox, inbox);
    await expect.poll(() => stored(mailbox, before)).toBe(1);

    // The open day shows it once the server says the calendar changed.
    await expect(days.getByText(before)).toBeVisible({ timeout: 60_000 });

    // A change after connecting reaches the same day too.
    const after = `Retro ${run}`;
    await eventToday(page, mailbox, address, after);
    await expect
      .poll(() => stored(mailbox, after), { timeout: 60_000 })
      .toBe(1);
    await expect(days.getByText(after)).toBeVisible({ timeout: 60_000 });
    await expect(days.getByText(before)).toBeVisible();
  });
});
