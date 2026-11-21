// What the second half of the send states tests (`states-send2-*.spec.ts`)
// share: the Queued email sends panel and the composer as a user reaches
// them, GraphQL operations refused, failed or held on their way to the
// services, another device signed in as the same user, and the delivery
// state Macro holds for a send, set the way the service leaves it; drafts
// saved and then scheduled, sent or deleted the way another tab does.

import type { Browser, Locator, Page, Request, Route } from '@playwright/test';
import { keepCalendarPromptClosed } from './calendar-prompt';
import { composeNew, graphqlOperation, loadAppSteadily } from './drafts';
import { expect, type Mailbox, type ThreadPreview } from './fixtures';
import { replyTo } from './ways-compose2';

/** Opens the Drafts tab of the mail list and gives its Queued email sends panel. */
export async function sendsPanel(page: Page): Promise<Locator> {
  await page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Drafts' })
    .click();
  return page.getByLabel('Queued email sends');
}

/** A status line of the panel, by its text. */
export function sendStatus(panel: Locator, text: string | RegExp): Locator {
  return panel.getByRole('status').filter({ hasText: text });
}

/** A button of the panel, by its exact name. */
export function panelButton(panel: Locator, name: string): Locator {
  return panel.getByRole('button', { name, exact: true });
}

/** A GraphQL error the services answer an operation with. */
export type GraphqlRefusal = { message: string; code?: string };

/**
 * Answers the GraphQL operation `name` with `refusal` while `refusing()`
 * says so; other requests go on to the services.
 */
export async function refuseOperation(
  page: Page,
  name: string,
  field: string,
  refusal: GraphqlRefusal,
  refusing: () => boolean = () => true
): Promise<void> {
  await page.route(/\/graphql$/, async (route) => {
    if (graphqlOperation(route.request()) !== name || !refusing())
      return route.fallback();
    await route.fulfill({
      json: {
        data: null,
        errors: [
          {
            message: refusal.message,
            path: [field],
            ...(refusal.code ? { extensions: { code: refusal.code } } : {}),
          },
        ],
      },
    });
  });
}

/**
 * Fails the GraphQL operation `name` as a dropped connection does while
 * `failing()` says so.
 */
export async function failOperation(
  page: Page,
  name: string,
  failing: () => boolean = () => true
): Promise<void> {
  await page.route(/\/graphql$/, async (route) => {
    if (graphqlOperation(route.request()) !== name || !failing())
      return route.fallback();
    await route.abort('connectionfailed');
  });
}

/** Requests caught on their way out, let through when the test says so. */
export type Held = {
  /** Resolves once the first request is caught. */
  arrived: Promise<void>;
  /** Lets the caught requests, and every later one, go to the service. */
  release: () => Promise<void>;
};

/** Holds every request of the GraphQL operation `name` until `release`. */
export async function holdOperation(page: Page, name: string): Promise<Held> {
  return holdRequests(
    page,
    /\/graphql$/,
    (request) => graphqlOperation(request) === name
  );
}

/**
 * Holds every request to `url` that `matches` until `release`, as a slow
 * network does: the page waits for its answer meanwhile.
 */
export async function holdRequests(
  page: Page,
  url: RegExp,
  matches: (request: Request) => boolean = () => true
): Promise<Held> {
  const routes: Route[] = [];
  let released = false;
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  await page.route(url, async (route) => {
    if (released || !matches(route.request())) return route.fallback();
    routes.push(route);
    arrive();
  });
  return {
    arrived,
    release: async () => {
      released = true;
      // A request the page gave up on meanwhile cannot be let through.
      await Promise.all(
        routes.map((route) => route.fallback().catch(() => {}))
      );
    },
  };
}

/**
 * Lets requests to `url` through until the function given back is called,
 * and fails them from then on, as a dropped connection does. The call waits
 * until the requests let through are answered, so none the page sent before
 * it is answered after it with what changed meanwhile.
 */
export async function failRequestsLater(
  page: Page,
  url: RegExp
): Promise<() => Promise<void>> {
  const open = new Set<Request>();
  let failing = false;
  const answered = (request: Request) => open.delete(request);
  page.on('requestfinished', answered);
  page.on('requestfailed', answered);
  await page.route(url, (route) => {
    if (failing) return route.abort('connectionfailed');
    open.add(route.request());
    return route.fallback();
  });
  return async () => {
    failing = true;
    await expect
      .poll(() => open.size, {
        message: 'the requests let through before failing are answered',
      })
      .toBe(0);
  };
}

/**
 * Tells the page it is shown again, as switching back to its tab does: what
 * reads on focus or visibility reads again now instead of on its timer.
 */
export async function returnToTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('visibilitychange'));
  });
}

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

/** How many sends of the inbox Macro holds neither sent nor cancelled. */
export async function openSendAttempts(mailbox: Mailbox): Promise<number> {
  const rows = await mailbox.stack.sql(
    `SELECT attempt_id FROM email_send_attempts
     WHERE link_id = '${mailbox.inbox.linkId}' AND NOT cancelled AND NOT sent`
  );
  return rows.length;
}

/**
 * Sets whether Macro holds the inbox's one open send as unconfirmed, as the
 * service leaves a send whose outcome it could not learn; cleared, it waits
 * for its time again.
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
 * Leaves `count` sends of the user's in Macro whose outcome the service
 * could not learn, as sends made on other devices over time leave them:
 * neither sent nor cancelled, each a second older than the last.
 */
export async function unconfirmedSendsElsewhere(
  mailbox: Mailbox,
  count: number
): Promise<void> {
  const user = mailbox.user.macroUserId.replaceAll("'", "''");
  const rows = await mailbox.stack.sql(
    `INSERT INTO email_send_attempts
       (user_id, link_id, attempt_id, delivery_unconfirmed, created_at)
     SELECT '${user}', '${mailbox.inbox.linkId}', gen_random_uuid(), true,
            now() - make_interval(secs => n)
     FROM generate_series(1, ${count}) AS n
     RETURNING attempt_id`
  );
  if (rows.length !== count)
    throw new Error(`${rows.length} sends left, not ${count}`);
}

/**
 * Sets what Macro holds about a scheduled message's delivery: `unconfirmed`
 * as a sweep leaves a send whose outcome it could not learn.
 */
export async function setScheduledUnconfirmed(
  mailbox: Mailbox,
  messageId: string
): Promise<void> {
  const rows = await mailbox.stack.sql(
    `UPDATE email_scheduled_messages SET delivery_status = 'unconfirmed',
       processing = true, delivery_claim_id = gen_random_uuid(),
       delivery_started_at = now()
     WHERE message_id = '${messageId}' AND link_id = '${mailbox.inbox.linkId}'
     RETURNING message_id`
  );
  if (rows.length !== 1)
    throw new Error(`no scheduled message ${messageId} to change`);
}

/** Makes a scheduled message due now, for the next sweep to send. */
export async function makeDue(
  mailbox: Mailbox,
  messageId: string
): Promise<void> {
  const rows = await mailbox.stack.sql(
    `UPDATE email_scheduled_messages SET send_time = now() - interval '1 second'
     WHERE message_id = '${messageId}' AND link_id = '${mailbox.inbox.linkId}'
     RETURNING message_id`
  );
  if (rows.length !== 1)
    throw new Error(`no scheduled message ${messageId} to make due`);
}

/**
 * Gives the user a professional subscription, as paying for one does: only
 * then may they link a third inbox.
 */
export async function subscribeProfessional(mailbox: Mailbox): Promise<void> {
  await mailbox.stack.sql(
    `INSERT INTO "RolesOnUsers" ("userId", "roleId")
     VALUES (${literal(mailbox.user.macroUserId)}, 'professional_subscriber')
     ON CONFLICT DO NOTHING
     RETURNING "roleId"`
  );
}

/** SQL text for a quoted string literal. */
function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * The draft Macro holds for the inbox under this subject, or in this thread,
 * once its saved text holds `holding` (the last words typed into it).
 */
export async function savedDraft(
  mailbox: Mailbox,
  where: { subject: string } | { threadId: string },
  holding = ''
): Promise<string | undefined> {
  const which =
    'subject' in where
      ? `subject = ${literal(where.subject)}`
      : `thread_id = ${literal(where.threadId)}`;
  const rows = (await mailbox.stack.sql(
    `SELECT id FROM email_messages
     WHERE link_id = '${mailbox.inbox.linkId}' AND is_draft AND ${which}
       AND position(${literal(holding)} IN coalesce(body_text, '')
         || coalesce(body_macro, '') || coalesce(body_html_sanitized, '')) > 0`
  )) as { id: string }[];
  return rows[0]?.id;
}

/** The reply editor of an open thread. */
export function replyBody(page: Page): Locator {
  return page.getByRole('textbox', { name: /^Reply — / });
}

/**
 * Writes a new email and waits until Macro holds all of it as a draft and
 * the composer knows the service took it (its route names the draft): only
 * then does the composer follow what happens to the draft elsewhere.
 */
export async function savedNew(
  page: Page,
  mailbox: Mailbox,
  subject: string
): Promise<string> {
  const text = 'The numbers are in.';
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject,
    body: text,
  });
  await expect.poll(() => savedDraft(mailbox, { subject }, text)).toBeTruthy();
  const draft = (await savedDraft(mailbox, { subject }, text)) as string;
  await expect(page).toHaveURL(new RegExp(`email-compose\\.draft=${draft}`));
  return draft;
}

/**
 * Waits until the email service told the app that a Gmail inbox (the test's
 * own, unless another is given) finished its first backfill. The app reads
 * the inbox list again when it hears it, which mounts an open composer
 * again, and says "Inbox synced"; a page opened afterwards never hears it.
 * (Copied from `backfillAnnounced` in `harness/ways-settings-more.ts`.)
 */
export async function backfilled(
  mailbox: Mailbox,
  inbox: { linkId: string } = mailbox.inbox
): Promise<void> {
  const mine = `/message/send/user/${mailbox.user.macroUserId}`;
  const announced = async () =>
    (await mailbox.stack.serviceRequests()).some((request) => {
      if (request.service !== 'connection-gateway') return false;
      if (decodeURIComponent(request.path) !== mine) return false;
      const body = request.body as {
        message_type?: string;
        message?: { event?: string; status?: string; link_id?: string };
      };
      return (
        body.message_type === 'refresh_email' &&
        body.message?.event === 'backfill_progress' &&
        body.message.status === 'complete' &&
        body.message.link_id === inbox.linkId
      );
    });
  await expect
    .poll(announced, {
      message: 'the Gmail inbox never announced the end of its backfill',
      timeout: 60_000,
    })
    .toBe(true);
}

/**
 * Opens a thread of a message from Xavier, writes a reply and waits until
 * Macro holds all of it as a draft in the thread.
 */
export async function savedReply(
  page: Page,
  mailbox: Mailbox,
  subject: string
): Promise<{ thread: ThreadPreview; draftId: string }> {
  const thread = await replyTo(page, mailbox, subject);
  await replyBody(page).click();
  await page.keyboard.type('Noted.');
  const draft = () => savedDraft(mailbox, { threadId: thread.id }, 'Noted.');
  await expect.poll(draft).toBeTruthy();
  return { thread, draftId: (await draft()) as string };
}

/** Whether Macro holds the inbox's message with this subject as sent. */
export async function sentFromMacro(
  mailbox: Mailbox,
  subject: string
): Promise<boolean> {
  const rows = await mailbox.stack.sql(
    `SELECT id FROM email_messages
     WHERE link_id = '${mailbox.inbox.linkId}' AND is_sent
       AND subject = ${literal(subject)}`
  );
  return rows.length > 0;
}

/** The generation Macro holds for a draft, which a schedule must name. */
async function draftGeneration(
  mailbox: Mailbox,
  draftId: string
): Promise<number> {
  const rows = (await mailbox.stack.sql(
    `SELECT draft_generation FROM email_messages
     WHERE id = '${draftId}' AND link_id = '${mailbox.inbox.linkId}'`
  )) as { draft_generation: number }[];
  if (rows.length !== 1) throw new Error(`no draft ${draftId}`);
  return Number(rows[0].draft_generation);
}

/**
 * Schedules a saved draft for `sendTime` the way another tab or device does,
 * through the email service as the signed-in user.
 */
export async function scheduleElsewhere(
  mailbox: Mailbox,
  draftId: string,
  sendTime: Date
): Promise<void> {
  const generation = await draftGeneration(mailbox, draftId);
  const response = await mailbox.api(
    `/email/email/drafts/scheduled/${draftId}?draft_generation=${generation}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ send_time: sendTime.toISOString() }),
    }
  );
  if (!response.ok)
    throw new Error(
      `scheduling answered ${response.status}: ${await response.text()}`
    );
}

/**
 * Deletes a saved draft the way another tab or device does, through the
 * email service as the signed-in user.
 */
export async function deleteElsewhere(
  mailbox: Mailbox,
  draftId: string
): Promise<void> {
  const generation = await draftGeneration(mailbox, draftId);
  const response = await mailbox.api(
    `/email/email/drafts/${draftId}?draft_generation=${generation}`,
    { method: 'DELETE' }
  );
  if (!response.ok)
    throw new Error(
      `deleting answered ${response.status}: ${await response.text()}`
    );
}

/** The key of the send record `unreadableSendRecord` leaves. */
const NEWER_BUILD_RECORD = 'from-a-newer-build';

/**
 * Writes into this browser's send journal a record a newer build of the app
 * left there, which this build cannot read, for the signed-in account. Says
 * false, writing nothing, while the app has not opened its journal for the
 * account yet; it never creates the journal itself.
 */
export async function unreadableSendRecord(page: Page): Promise<boolean> {
  return page.evaluate(async (key) => {
    const name = 'macro-email-working-copies-v1';
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === name)) return false;
    return new Promise<boolean>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (
          !db.objectStoreNames.contains('meta') ||
          !db.objectStoreNames.contains('sends')
        ) {
          db.close();
          resolve(false);
          return;
        }
        let written = false;
        const tx = db.transaction(['meta', 'sends'], 'readwrite');
        const session = tx.objectStore('meta').get('session');
        session.onsuccess = () => {
          const accountId = (session.result as { accountId?: string })
            ?.accountId;
          if (!accountId) return;
          tx.objectStore('sends').put(
            { uuid: key, accountId, dispatchVersion: 99 },
            key
          );
          written = true;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(written);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, NEWER_BUILD_RECORD);
}

/** Removes the record `unreadableSendRecord` left, as support would. */
export async function removeUnreadableSendRecord(page: Page): Promise<void> {
  await page.evaluate(
    (key) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('macro-email-working-copies-v1');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('sends', 'readwrite');
          tx.objectStore('sends').delete(key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    NEWER_BUILD_RECORD
  );
}

/** Graph access to the Outlook mailbox at the emulator, as its own client. */
async function outlookMailbox(mailbox: Mailbox) {
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

/**
 * The body of the Outlook mailbox's draft with this subject, and its id, if
 * the mailbox holds one. Macro writes its drafts into the mailbox only for
 * Outlook (crates/email/src/outbound/mailbox_pg/drafts.rs).
 */
export async function mailboxDraft(
  mailbox: Mailbox,
  subject: string
): Promise<{ id: string; body: string } | undefined> {
  const { control, graph, authorization } = await outlookMailbox(mailbox);
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
export async function editMailboxDraft(
  mailbox: Mailbox,
  subject: string,
  text: string
): Promise<void> {
  const draft = await mailboxDraft(mailbox, subject);
  if (!draft) throw new Error(`no draft "${subject}" in the mailbox`);
  const { graph, authorization } = await outlookMailbox(mailbox);
  const response = await fetch(`${graph}/messages/${draft.id}`, {
    method: 'PATCH',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ body: { contentType: 'Text', content: text } }),
  });
  if (!response.ok)
    throw new Error(`Outlook refused the edit: ${await response.text()}`);
}
