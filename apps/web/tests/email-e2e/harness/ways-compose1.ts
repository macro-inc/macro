// What the tests of the other ways into the new-email composer share: its
// recipient rows, the phone's composer, contacts the fields can suggest, and
// the message as the provider holds it once it is sent.

import { devices, expect, type Locator, type Page } from '@playwright/test';
import type { Mailbox } from './fixtures';
import { type ReadMessage, readMailbox } from './journeys';
import type { Provider } from './stack';

export const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

const { defaultBrowserType: _browser, ...iPhone } = devices['iPhone 13'];
/** The phone the suite uses (`journey-phone.spec.ts`). */
export const phone = iPhone;

/** `a Gmail` or `an Outlook`, for a test's title. */
export function named(provider: Provider): string {
  return provider === 'GMAIL' ? 'a Gmail' : 'an Outlook';
}

/** The one message `email` sent with this subject, as the provider holds it. */
export async function sentCopy(
  mailbox: Mailbox,
  subject: string,
  email: string = mailbox.inbox.email
): Promise<ReadMessage> {
  const sent = async () =>
    (await readMailbox(mailbox, email)).filter(
      (message) => message.subject === subject && message.from === email
    );
  await expect
    .poll(async () => (await sent()).length, {
      message: `the provider never received "${subject}"`,
      timeout: 30_000,
    })
    .toBe(1);
  return (await sent())[0];
}

/**
 * The composer row `To`, `Cc` or `Bcc` on a desktop: its label, its chips and
 * its input. The rows have no names, so this is the innermost element that
 * holds both the label and an input.
 */
export function recipientRow(page: Page, row: 'To' | 'Cc' | 'Bcc'): Locator {
  return page
    .locator('div')
    .filter({ has: page.getByText(row, { exact: true }) })
    .filter({ has: page.getByRole('combobox') })
    .last();
}

/** The input of a desktop recipient row. */
export function recipientInput(page: Page, row: 'To' | 'Cc' | 'Bcc'): Locator {
  return recipientRow(page, row).getByRole('combobox');
}

/** The chip of a recipient, wherever it is. */
export function chip(page: Page, address: string): Locator {
  return page.getByRole('link', { name: address });
}

/**
 * Makes people contacts of the signed-in user, so that the recipient fields
 * suggest them.
 */
export async function addContacts(
  mailbox: Mailbox,
  addresses: string[]
): Promise<void> {
  const me = mailbox.user.macroUserId;
  const values = addresses
    .map(
      (address) =>
        `(LEAST('macro|${address}' COLLATE "C", '${me}' COLLATE "C"), GREATEST('macro|${address}' COLLATE "C", '${me}' COLLATE "C"))`
    )
    .join(', ');
  await mailbox.stack.sql(
    `INSERT INTO contacts_connections (user1, user2) VALUES ${values} RETURNING user1`
  );
}

/**
 * Waits until the open app has read the account into its cache once: every
 * lane of items (it keeps a checkpoint per lane, and reads CRM entities
 * last) and the contacts. Until then, each page it writes makes the
 * recipient suggestions read their first window again, which takes back a
 * window a test just asked for. (The item lanes as `backfilled` in
 * `full-stack-notifications.spec.ts` reads them.)
 */
export async function cacheFilled(page: Page): Promise<void> {
  const filled = () =>
    page.evaluate(() => {
      const done = (key: string, field: string) =>
        !!JSON.parse(localStorage.getItem(key) ?? '{}')[field];
      const keys = Object.keys(localStorage);
      const lanes = keys.filter(
        (key) =>
          key.startsWith('graphql-soup-backfill:') &&
          !key.endsWith(':coordinator')
      );
      return (
        lanes.some((key) => key.endsWith(':auxiliary-entities')) &&
        lanes.every((key) => done(key, 'completed')) &&
        keys.some(
          (key) =>
            key.startsWith('graphql-contacts-backfill:') &&
            done(key, 'completedAt')
        )
      );
    });
  await expect
    .poll(filled, { message: 'the app never finished filling its cache' })
    .toBe(true);
}

/** Opens the phone's full-screen composer from the list's New email. */
export async function openPhoneComposer(
  page: Page,
  mailbox: Mailbox
): Promise<void> {
  await mailbox.open();
  await page.getByRole('button', { name: 'New email' }).tap();
  await expect(page.getByRole('button', { name: 'Send email' })).toBeVisible();
}

/** The message body of the phone's composer. */
export function phoneBody(page: Page): Locator {
  return page.getByRole('textbox', { name: /reference files/ });
}

/** The draft the service holds under this subject, or nothing. */
export async function storedDraft(
  mailbox: Mailbox,
  subject: string
): Promise<{ id: string; name: string } | undefined> {
  const response = await mailbox.api(
    '/email/email/threads/previews/cursor/drafts?limit=100'
  );
  if (!response.ok) throw new Error(`drafts answered ${response.status}`);
  const { items } = (await response.json()) as {
    items: { id: string; name: string }[];
  };
  return items.find((item) => item.name === subject);
}

/**
 * Opens the desktop's new-message composer and waits until its To field
 * holds the focus: keys typed before that are hotkeys of the page behind.
 */
export async function openComposer(
  page: Page,
  mailbox: Mailbox
): Promise<Locator> {
  await mailbox.open('/app/mail/new');
  await expect(page.getByRole('button', { name: 'Send email' })).toBeVisible();
  const to = recipientInput(page, 'To');
  await to.click();
  await expect(to).toBeFocused();
  return to;
}
