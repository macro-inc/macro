// More of what the send ways-in tests share, beside the frozen
// `ways-send.ts`: a draft's copy in an Outlook mailbox, read and changed the
// way Outlook's own client does, and the delivery state Macro holds for a
// scheduled message.
//
// Macro writes its drafts into the mailbox only for Outlook; a Gmail inbox's
// drafts stay in Macro (crates/email/src/outbound/mailbox_pg/drafts.rs, the
// `l.provider = 'OUTLOOK'` claim).

import type { Browser, Page, Request } from '@playwright/test';
import { keepCalendarPromptClosed } from './calendar-prompt';
import { loadAppSteadily } from './drafts';
import type { Mailbox } from './fixtures';

/** The app on another device: the same signed-in user, in a browser of its own. */
export type OtherDevice = { page: Page; close: () => Promise<void> };

/**
 * Opens the mail list as the same user in a browser context of its own, as
 * on another device: it shares the account but holds none of this browser's
 * queued sends or drafts. Its sockets stay silent, as the fixture leaves
 * those of services the stack does not run; a run proving a break switches
 * the break on here too.
 */
export async function anotherDevice(
  browser: Browser,
  mailbox: Mailbox
): Promise<OtherDevice> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('macro:login', 'true');
  });
  await keepCalendarPromptClosed(page, mailbox.inbox.linkId);
  const broken = process.env.EMAIL_E2E_BREAK;
  if (broken) {
    await page.addInitScript((name) => {
      (globalThis as { emailE2eBreak?: string }).emailE2eBreak = name;
    }, broken);
  }
  await page.routeWebSocket(/\/connection-gateway(\/|\?|$)/, () => {});
  await page.routeWebSocket(/\/websocket(\/|\?|$)/, () => {});
  await loadAppSteadily(page);
  await page.goto(`${mailbox.front.origin}/app/mail`);
  return { page, close: () => context.close() };
}

async function outlook(mailbox: Mailbox) {
  if (mailbox.inbox.provider !== 'OUTLOOK')
    throw new Error('only an Outlook mailbox holds Macro’s drafts');
  const base = mailbox.stack.info.outlookUrl;
  const email = encodeURIComponent(mailbox.inbox.email);
  const response = await fetch(
    `${base}/_emulator/mailboxes/${email}/access-tokens`,
    { method: 'POST' }
  );
  if (!response.ok) throw new Error(`no token: ${response.status}`);
  const { access_token } = (await response.json()) as { access_token: string };
  return {
    control: `${base}/_emulator/mailboxes/${email}`,
    graph: `${base}/v1.0/users/${email}`,
    authorization: `Bearer ${access_token}`,
  };
}

/** A draft in the mailbox at the provider: its message id and its body. */
export type ProviderDraft = { id: string; body: string };

/** The Outlook mailbox's draft with this subject, if it holds one. */
export async function draftAtProvider(
  mailbox: Mailbox,
  subject: string
): Promise<ProviderDraft | undefined> {
  const { control, graph, authorization } = await outlook(mailbox);
  const listed = await fetch(`${control}/messages`);
  if (!listed.ok) throw new Error(`no messages: ${listed.status}`);
  const summaries = (await listed.json()) as {
    id: string;
    is_draft: boolean;
  }[];
  for (const summary of summaries) {
    if (!summary.is_draft) continue;
    const response = await fetch(`${graph}/messages/${summary.id}`, {
      headers: { authorization },
    });
    if (!response.ok) throw new Error(`no Outlook message ${summary.id}`);
    const message = (await response.json()) as {
      subject: string;
      body: { content: string };
    };
    if (message.subject === subject)
      return { id: summary.id, body: message.body.content };
  }
  return undefined;
}

/**
 * Rewrites the body of the Outlook draft with this subject, as Outlook's own
 * client does while Macro is not looking.
 */
export async function editDraftAtProvider(
  mailbox: Mailbox,
  subject: string,
  text: string
): Promise<void> {
  const draft = await draftAtProvider(mailbox, subject);
  if (!draft) throw new Error(`no draft "${subject}" at the provider`);
  const { graph, authorization } = await outlook(mailbox);
  const response = await fetch(`${graph}/messages/${draft.id}`, {
    method: 'PATCH',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ body: { contentType: 'Text', content: text } }),
  });
  if (!response.ok)
    throw new Error(`Outlook refused the edit: ${await response.text()}`);
}

/** How many sends of the inbox Macro holds neither sent nor cancelled. */
export async function openSendAttempts(mailbox: Mailbox): Promise<number> {
  const rows = await mailbox.stack.sql(
    `SELECT attempt_id FROM email_send_attempts
     WHERE link_id = '${mailbox.inbox.linkId}' AND NOT cancelled AND NOT sent`
  );
  return rows.length;
}

/**
 * Sets whether Macro holds the inbox's one open send attempt as unconfirmed,
 * as the service leaves a send whose outcome it could not learn; cleared, it
 * is waiting for its time again.
 */
export async function setSendUnconfirmed(
  mailbox: Mailbox,
  unconfirmed: boolean
): Promise<void> {
  const rows = await mailbox.stack.sql(
    `UPDATE email_send_attempts SET delivery_unconfirmed = ${unconfirmed}
     WHERE link_id = '${mailbox.inbox.linkId}' AND NOT cancelled AND NOT sent
     RETURNING attempt_id`
  );
  if (rows.length !== 1)
    throw new Error(`${rows.length} open send attempts, not one`);
}

/**
 * Sets what Macro holds about a scheduled message's delivery: `unconfirmed`
 * as a sweep leaves a send whose outcome it could not learn, `pending` as a
 * message still waiting for its time.
 */
export async function setScheduledDelivery(
  mailbox: Mailbox,
  messageId: string,
  state: 'unconfirmed' | 'pending'
): Promise<void> {
  const set =
    state === 'unconfirmed'
      ? `delivery_status = 'unconfirmed', processing = true,
         delivery_claim_id = gen_random_uuid(), delivery_started_at = now()`
      : `delivery_status = 'ready', processing = false,
         delivery_claim_id = NULL, delivery_started_at = NULL`;
  const rows = await mailbox.stack.sql(
    `UPDATE email_scheduled_messages SET ${set}
     WHERE message_id = '${messageId}' AND link_id = '${mailbox.inbox.linkId}'
     RETURNING message_id`
  );
  if (rows.length !== 1)
    throw new Error(`no scheduled message ${messageId} to change`);
}

/**
 * Leaves the page's socket to the connection gateway silent, as the fixture
 * leaves those of services the stack does not run: a message the email
 * services announce then no longer makes an open composer ask the service
 * again by itself. Call it before the page opens the app.
 */
export async function silenceGateway(page: Page): Promise<void> {
  // The route registered last answers the socket, ahead of the fixture's.
  await page.routeWebSocket(/\/connection-gateway(\/|\?|$)/, () => {});
}

/**
 * Counts the page's reads of a thread over REST that are still on their way:
 * how an open composer learns what the service holds for its draft, as it
 * opens and whenever it asks again.
 */
export function draftStateReadsInFlight(page: Page): () => number {
  const inFlight = new Set<Request>();
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    const { pathname } = new URL(request.url());
    if (/\/email\/email\/threads\/[^/]+$/.test(pathname)) inFlight.add(request);
  });
  page.on('requestfinished', (request) => inFlight.delete(request));
  page.on('requestfailed', (request) => inFlight.delete(request));
  return () => inFlight.size;
}
