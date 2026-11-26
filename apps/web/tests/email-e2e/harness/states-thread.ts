// What the tests of a thread's states share: a thread done in the provider's
// own client, one another user shared and one with an empty reply started in
// Gmail, GraphQL operations the page sends
// made to fail or held back, threads long enough to load in pages, and the
// calendar files of a cancelled event and of a guest's answer.

import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { graphqlOperation } from './drafts';
import type { Mailbox } from './fixtures';
import { gmailSaveDraft } from './send';
import { changeAtProvider } from './sync';
import { hasDraft } from './ways-compose2';

const GRAPHQL = /\/graphql(\?|$)/;

/**
 * Delivers a message (body "About <subject>.") that its owner then archives
 * in the provider's own client, and waits until Macro lists it out of the
 * inbox. Answers its thread's id. The page has never seen the thread.
 */
export async function archivedAtProvider(
  mailbox: Mailbox,
  subject: string
): Promise<string> {
  const message = await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject,
    text: `About ${subject}.`,
  });
  const { id } = await mailbox.synced(subject);
  await changeAtProvider(mailbox, message.id, { archived: true });
  await expect
    .poll(
      async () => {
        const response = await mailbox.api(
          '/email/email/threads/previews/cursor/inbox?limit=100',
          { headers: { 'x-email-link-id': mailbox.inbox.linkId } }
        );
        const page = (await response.json()) as { items?: { id: string }[] };
        return (page.items ?? []).some((thread) => thread.id === id);
      },
      { timeout: 60_000 }
    )
    .toBe(false);
  return id;
}

/**
 * Delivers a message from Hugo (body "About <subject>.") to Bob's own
 * mailbox, of the same provider, and shares Bob's thread with the signed-in
 * user with edit access. Answers the thread's id.
 */
export async function sharedByBob(
  mailbox: Mailbox,
  subject: string
): Promise<string> {
  const bob = await mailbox.stack.user('bob@example.com');
  await mailbox.stack.link(bob, mailbox.inbox.provider);
  await mailbox.stack.deliver('bob@example.com', {
    from: 'Hugo <hugo@example.com>',
    subject,
    text: `About ${subject}.`,
  });
  let theirs: { id: string }[] = [];
  await expect
    .poll(
      async () => {
        theirs = await mailbox.stack.sql<{ id: string }>(
          `SELECT t.id FROM email_threads t JOIN email_links l ON l.id = t.link_id WHERE l.email_address = 'bob@example.com'`
        );
        return theirs.length;
      },
      { timeout: 60_000 }
    )
    .toBe(1);
  const [{ id }] = theirs;
  // The grant the Share dialog leaves, written directly: sharing with a
  // person goes through services this stack does not run.
  await mailbox.stack.sql(
    `INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ('${id}'::uuid, 'email_thread', '${mailbox.user.macroUserId}', 'user', 'edit') RETURNING entity_id`
  );
  return id;
}

/**
 * Delivers a message from Grace (body "About <subject>.") to a Gmail inbox
 * and starts a reply to it in Gmail's own client that has no text yet, only
 * the message quoted under it; Gmail then tells Macro. Answers the thread's
 * id once Macro holds the draft.
 */
export async function emptyReplyAtGmail(
  mailbox: Mailbox,
  subject: string
): Promise<string> {
  const messageId = `${subject.toLowerCase().replace(/\W+/g, '-')}-1@example.com`;
  const received = await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject,
    text: `About ${subject}.`,
    messageId,
  });
  const { id } = await mailbox.synced(subject);
  await gmailSaveDraft(mailbox, {
    threadId: received.threadId,
    raw: [
      `From: ${mailbox.inbox.email}`,
      'To: grace@example.com',
      `Subject: Re: ${subject}`,
      `In-Reply-To: <${messageId}>`,
      `References: <${messageId}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="utf-8"',
      '',
      `<div dir="ltr"><br></div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Thu, Grace wrote:<br></div><blockquote class="gmail_quote">About ${subject}.</blockquote></div>`,
    ].join('\r\n'),
  });
  const pushed = await fetch(
    `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}/push`,
    { method: 'POST' }
  );
  if (!pushed.ok) throw new Error(`Gmail did not push: ${pushed.status}`);
  await expect
    .poll(() => hasDraft(mailbox, id), { timeout: 60_000 })
    .toBe(true);
  return id;
}

/**
 * Makes the document storage service refuse a GraphQL operation for good
 * while `failing()` answers true: an `INVALID` error, which the mutation
 * queue does not retry.
 */
export async function refuseOperation(
  page: Page,
  operation: string,
  failing: () => boolean = () => true
): Promise<void> {
  await page.route(GRAPHQL, (route) => {
    if (graphqlOperation(route.request()) !== operation || !failing())
      return route.fallback();
    return route.fulfill({
      json: {
        data: null,
        errors: [{ message: 'refused', extensions: { code: 'INVALID' } }],
      },
    });
  });
}

/**
 * Holds back the GraphQL requests of an operation whose body `matches`, from
 * now until `release()`, which lets the held ones and every later one through.
 */
export async function holdOperation(
  page: Page,
  operation: string,
  matches: (body: string) => boolean = () => true
): Promise<{ held: () => number; release: () => Promise<void> }> {
  const held: Route[] = [];
  let holding = true;
  await page.route(GRAPHQL, (route) => {
    const request = route.request();
    if (
      !holding ||
      graphqlOperation(request) !== operation ||
      !matches(request.postData() ?? '')
    )
      return route.fallback();
    held.push(route);
  });
  return {
    held: () => held.length,
    release: async () => {
      holding = false;
      for (const route of held.splice(0)) await route.fallback();
    },
  };
}

/**
 * Bodies of a thread's messages, each long enough that a page of them
 * overflows the view: a thread that does not overflow loads its older page
 * by itself.
 */
export function longPoints(count: number): { text: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    text: [
      `Point number ${index + 1} of the plan.`,
      ...Array.from({ length: 60 }, (_, line) => `Detail ${line + 1}.`),
    ].join('\n\n'),
  }));
}

/** A calendar file with one event of Grace's, on 14 January 2027, 17:00 UTC. */
function eventFile(method: string, lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Example//Calendar//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    'DTSTART:20270114T170000Z',
    'DTEND:20270114T180000Z',
    'DTSTAMP:20261112T120000Z',
    'ORGANIZER;CN=Grace:mailto:grace@example.com',
    ...lines,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** The organizer's cancellation of an event Ada was invited to. */
export function cancelFile(event: { uid: string; summary: string }): string {
  return eventFile('CANCEL', [
    `UID:${event.uid}`,
    'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;CN=Ada:mailto:ada@example.com',
    'SEQUENCE:1',
    'STATUS:CANCELLED',
    `SUMMARY:${event.summary}`,
  ]);
}

/** A guest's answer to Grace's event, with the comment they wrote. */
export function replyFile(event: {
  uid: string;
  summary: string;
  guest: string;
  status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
  comment: string;
}): string {
  return eventFile('REPLY', [
    `UID:${event.uid}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=${event.status};CN=${event.guest}:mailto:${event.guest.toLowerCase()}@example.com`,
    `COMMENT:${event.comment}`,
    'SEQUENCE:0',
    `SUMMARY:${event.summary}`,
  ]);
}

/**
 * The caret beside a message's recipients line, which has no name of its
 * own: the tooltip it shows names it.
 */
export function headerCaret(card: Locator): Locator {
  return card
    .getByText(/^to /)
    .first()
    .locator('xpath=following-sibling::div[1]')
    .getByRole('button');
}
