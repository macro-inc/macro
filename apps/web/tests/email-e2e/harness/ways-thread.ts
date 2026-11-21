// What the tests of the other ways into a thread's functions share: the rows
// and the open thread, what the services hold for a thread and its sender,
// and mail with a calendar file.

import { devices, type Locator, type Page } from '@playwright/test';
import { expect, type Mailbox } from './fixtures';
import { threadMessages } from './thread';

const { defaultBrowserType: _browser, ...iPhone } = devices['iPhone 13'];

/** The phone the suite's phone tests use. */
export const phone = iPhone;

export const FROM = 'Grace <grace@example.com>';

/** The row of a thread in the list. */
export function row(page: Page, threadId: string): Locator {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** Delivers one message per subject from Grace and answers the thread ids. */
export async function deliverEach(
  mailbox: Mailbox,
  subjects: string[],
  from: (subject: string) => string = () => FROM
): Promise<Record<string, string>> {
  for (const subject of subjects) {
    await mailbox.deliver({
      from: from(subject),
      subject,
      text: `About ${subject}.`,
    });
  }
  const ids: Record<string, string> = {};
  for (const subject of subjects) {
    ids[subject] = (await mailbox.synced(subject)).id;
  }
  return ids;
}

/**
 * Opens a thread from its row in the list and waits for its message, with
 * the keyboard in the thread.
 */
export async function openFromList(
  page: Page,
  threadId: string,
  text: string
): Promise<void> {
  await row(page, threadId).click();
  await expect(page).toHaveURL(new RegExp(`/app/mail/${threadId}`));
  await expect(page.getByText(text).first()).toBeVisible();
}

/** The provider's copy of the message with this subject. */
export async function held(mailbox: Mailbox, subject: string) {
  return (await mailbox.providerMessages()).find(
    (message) => message.subject === subject
  );
}

/** The threads the storage service holds as the user's favorites. */
export async function favorites(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/dss/favorites');
  const body = (await response.json()) as {
    favorites: { entityType: string; entityId: string }[];
  };
  return body.favorites
    .filter(({ entityType }) => entityType === 'email_thread')
    .map(({ entityId }) => entityId);
}

/** The senders the email service answers as blocked in the inbox. */
export async function blocked(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/contacts/blocked');
  return ((await response.json()) as { blocked_emails: string[] })
    .blocked_emails;
}

/** The inbox's sender filters: the address and whether it is Signal. */
export async function senderFilters(
  mailbox: Mailbox
): Promise<{ address: string | null; signal: boolean }[]> {
  const response = await mailbox.api('/email/email/filters');
  const body = (await response.json()) as {
    filters: { email_address: string | null; is_important: boolean }[];
  };
  return body.filters
    .map((filter) => ({
      address: filter.email_address,
      signal: filter.is_important,
    }))
    .sort((a, b) => String(a.address).localeCompare(String(b.address)));
}

/**
 * Runs a command of the open thread from the command menu: Cmd+K, the
 * command's name typed, and the command picked from the results.
 */
export async function runThreadCommand(
  page: Page,
  name: string
): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('textbox', { name: /^Search/ });
  await expect(search).toBeVisible();
  await search.fill(name);
  await page
    .getByRole('listbox', { name: 'Search results' })
    .getByRole('option', { name: new RegExp(`^${name}`) })
    .first()
    .click();
  await expect(search).toHaveCount(0);
}

/** Waits until every message of a thread is read in Macro. */
export async function allRead(
  mailbox: Mailbox,
  threadId: string
): Promise<void> {
  await expect
    .poll(async () =>
      (await threadMessages(mailbox, threadId)).every(
        (message) => message.is_read
      )
    )
    .toBe(true);
}

/**
 * Which of the thread's messages are open, top to bottom: an open message
 * shows its recipients line, a collapsed row does not.
 */
export async function openMessages(cards: Locator): Promise<boolean[]> {
  const open: boolean[] = [];
  for (const card of await cards.all()) {
    open.push((await card.getByText('to Me').count()) > 0);
  }
  return open;
}

/**
 * An event as the `.ics` file a calendar sends: an invitation by default.
 * With `moved`, a weekly event and one occurrence of it moved to another
 * hour, which a message carries as two events of one series.
 */
export function calendarFile(event: {
  uid: string;
  summary: string;
  method?: 'REQUEST' | 'PUBLISH';
  description?: string;
  moved?: boolean;
}): string {
  const vevent = (lines: string[]) => [
    'BEGIN:VEVENT',
    ...lines,
    'DTSTAMP:20261112T120000Z',
    'ORGANIZER;CN=Grace:mailto:grace@example.com',
    `UID:${event.uid}`,
    'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Ada:mailto:ada@example.com',
    ...(event.description ? [`DESCRIPTION:${event.description}`] : []),
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    `SUMMARY:${event.summary}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Example//Calendar//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method ?? 'REQUEST'}`,
    ...vevent([
      'DTSTART:20270114T170000Z',
      'DTEND:20270114T180000Z',
      ...(event.moved ? ['RRULE:FREQ=WEEKLY;COUNT=4'] : []),
    ]),
    ...(event.moved
      ? vevent([
          'DTSTART:20270121T190000Z',
          'DTEND:20270121T200000Z',
          'RECURRENCE-ID:20270121T170000Z',
        ])
      : []),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/**
 * Delivers a message with a calendar file the way each provider carries one:
 * Gmail as the `.ics` attachment alone, Outlook as an event message that
 * holds the calendar and the file. Waits until the service has read the
 * events out of it, and answers the thread's id.
 */
export async function deliverCalendarFile(
  mailbox: Mailbox,
  mail: { subject: string; text: string },
  file: { filename: string; ics: string; events?: number }
): Promise<string> {
  const method = /METHOD:(\w+)/.exec(file.ics)?.[1] ?? 'REQUEST';
  const base64 = Buffer.from(file.ics).toString('base64');
  if (mailbox.inbox.provider === 'GMAIL') {
    await mailbox.deliver({
      from: FROM,
      ...mail,
      attachments: [
        {
          filename: file.filename,
          mimeType: `text/calendar; method=${method}; charset=UTF-8`,
          base64,
        },
      ],
    });
  } else {
    const response = await fetch(
      `${mailbox.stack.info.outlookUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          ...mail,
          calendar: file.ics,
          attachments: [
            { filename: file.filename, mime_type: 'text/calendar', base64 },
          ],
        }),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Outlook refused the event: ${response.status} ${await response.text()}`
      );
    }
  }
  const thread = await mailbox.synced(mail.subject);
  // The events are read out of the message after the message itself syncs,
  // and an open thread hears of them over the websocket the stack does not
  // run: the thread is opened once the service holds them.
  await expect
    .poll(
      async () =>
        (await threadMessages(mailbox, thread.id)).map(
          (message) =>
            ((message.calendar_invitations as unknown[]) ?? []).length
        ),
      { timeout: 60_000 }
    )
    .toEqual([file.events ?? 1]);
  return thread.id;
}

/**
 * Lets the page fetch from the stack's object storage, which answers no CORS
 * headers: the test process fetches for it.
 */
export async function relayStorage(
  page: Page,
  mailbox: Mailbox
): Promise<void> {
  const app = new URL(mailbox.front.origin).origin;
  await page.route(
    (url) => url.origin !== app,
    async (route) => {
      if (route.request().resourceType() !== 'fetch') return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'access-control-allow-origin': '*',
        },
      });
    }
  );
}
