// What a reply says when it has no inbox to go from, in a thread another
// person shared at Edit (which lets the reader reply from an inbox of their
// own): the reader has none, their inboxes could not be read, or they are
// still loading.
//
// The Share dialog shares an email with a person by granting Edit to their
// direct-message channel, through the channels service, which the stack does
// not run. A grant at Edit to the person themselves, written to the database
// as `harness/sharing.ts` does for View, stands in for it: access that comes
// through channel membership is not tested here.

import type { Page } from '@playwright/test';
import { graphqlOperation, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice, replyEditor } from './harness/send';
import { readStatus, threadOf } from './harness/sharing';
import type { Provider } from './harness/stack';
import { hold, operation } from './harness/states-send1';
import { disconnectInbox } from './harness/ways-elsewhere';
import { saw } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

/**
 * A thread of bob's own inbox, with Edit granted to the signed-in user (see
 * the top of the file). Answers its id once the user may open it.
 */
async function sharedAtEdit(
  mailbox: Mailbox,
  provider: Provider
): Promise<string> {
  const bob = await mailbox.stack.user('bob@example.com');
  await mailbox.stack.link(bob, provider);
  await mailbox.stack.deliver('bob@example.com', {
    from: 'Hugo <hugo@example.com>',
    subject: 'Offsite',
    text: 'Which week suits you?',
  });
  const thread = await threadOf(mailbox, 'bob@example.com');
  await mailbox.stack.sql(
    `INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
     VALUES ('${thread}'::uuid, 'email_thread', '${mailbox.user.macroUserId}', 'user', 'edit')
     RETURNING entity_id`
  );
  expect(await readStatus(mailbox, mailbox.user, thread)).toBe(200);
  return thread;
}

/** Opens the shared thread and writes a reply to it. */
async function writeReply(
  page: Page,
  mailbox: Mailbox,
  thread: string
): Promise<void> {
  await mailbox.open(`/app/mail/${thread}`);
  await expect(page.getByText('Which week suits you?')).toBeVisible();
  await page.getByText('Reply...').click();
  await replyEditor(page).pressSequentially('The second week.');
}

/**
 * The bodies of the drafts this browser keeps on this device, joined. A
 * kept body is HTML in base64, as the composer saves it.
 */
async function keptOnThisDevice(page: Page): Promise<string> {
  const bodies = await page.evaluate(async () => {
    const name = 'macro-email-working-copies-v1';
    // Never create the store: the app does, once it has something to keep.
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === name)) return [];
    return new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('drafts')) {
          db.close();
          resolve([]);
          return;
        }
        const all = db
          .transaction('drafts', 'readonly')
          .objectStore('drafts')
          .getAll();
        all.onerror = () => reject(all.error);
        all.onsuccess = () => {
          db.close();
          resolve(
            (all.result as { content?: { body_html?: string | null } }[]).map(
              (draft) => draft.content?.body_html ?? ''
            )
          );
        };
      };
    });
  });
  return bodies
    .map((body) => Buffer.from(body, 'base64').toString('utf8'))
    .join('\n');
}

/** The composer's Send button. */
function sendButton(page: Page) {
  return page.getByRole('button', { name: 'Send email', exact: true });
}

for (const provider of PROVIDERS) {
  test.describe(`a reply to a thread shared at Edit, the owner's being ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, a reader of a shared thread with no inbox of their
    // own presses Send and is not told why nothing goes out, or the reply
    // is sent from someone else's inbox.
    test('a reader with no inbox is told that none is connected', async ({
      page,
      mailbox,
    }) => {
      const thread = await sharedAtEdit(mailbox, provider);
      await disconnectInbox(mailbox);

      await writeReply(page, mailbox, thread);
      await sendButton(page).click();
      await expect(
        notice(page, 'Email failed to send: No email account connected')
      ).toBeVisible();
      saw('STC-042');
    });

    // When this fails, a reader of a shared thread whose inboxes could not
    // be read presses Send and is not told why nothing goes out, or the
    // reply goes from a guessed inbox.
    test('a reader whose inboxes could not be read is told so', async ({
      page,
      mailbox,
    }) => {
      const thread = await sharedAtEdit(mailbox, provider);
      await page.route(/\/graphql$/, async (route) => {
        if (graphqlOperation(route.request()) !== 'MailAccounts')
          return route.fallback();
        await route.fulfill({ status: 500, body: '{}' });
      });

      await writeReply(page, mailbox, thread);
      await sendButton(page).click();
      await expect(
        notice(page, 'Email failed to send: Could not load email accounts')
      ).toBeVisible();
      saw('STC-041');
    });

    // When this fails, a reply to a shared thread kept on this device and
    // reopened before the reader's inboxes have loaded is sent from no
    // inbox, or nothing tells the reader to wait.
    test('a reply reopened before the reader’s inboxes load says they are loading', async ({
      page,
      mailbox,
    }) => {
      const thread = await sharedAtEdit(mailbox, provider);
      const accounts = await hold(page, operation('MailAccounts'));
      // The reply stays on this device alone, as it does offline.
      const saves = await hold(page, operation('SaveEmailDraft'));

      await writeReply(page, mailbox, thread);
      await expect
        .poll(() => keptOnThisDevice(page))
        .toContain('The second week.');
      await page.reload();
      await expect(replyEditor(page)).toContainText('The second week.');
      await sendButton(page).click();
      await expect(notice(page, 'Loading email accounts...')).toBeVisible();
      saw('STC-040');
      await saves.release();
      await accounts.release();
    });
  });
}
