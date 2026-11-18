// What the `ways-compose2-*` specs share: a thread opened with one of its
// message's own buttons pressed, and the sent copy the provider then holds.

import { devices, type Locator, type Page } from '@playwright/test';
import { expect, type Mailbox, type ThreadPreview } from './fixtures';
import { type ReadMessage, readMailbox } from './journeys';

export const XAVIER = 'xavier@example.com';
export const YARA = 'yara@example.com';

const { defaultBrowserType: _browser, ...iphone } = devices['iPhone 13'];
/** The phone the suite's phone tests run on (`journey-phone.spec.ts`). */
export const PHONE = iphone;

/** A picture of one pixel. */
export const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * Delivers a message from Xavier (Yara in Cc when `cc`) and opens its
 * thread. The message's text is its subject with a full stop, so that
 * several threads of one test stay apart.
 */
export async function openThread(
  page: Page,
  mailbox: Mailbox,
  subject: string,
  options: { cc?: boolean } = {}
): Promise<ThreadPreview> {
  await mailbox.deliver({
    from: `Xavier <${XAVIER}>`,
    to: mailbox.inbox.email,
    cc: options.cc ? `Yara <${YARA}>` : undefined,
    subject,
    text: textOf(subject),
  });
  const thread = await mailbox.synced(subject);
  await mailbox.open(`/app/mail/${thread.id}`);
  // On a phone the list stays mounted under the thread, hidden, and its row
  // shows the same text.
  await expect(
    page.getByText(textOf(subject)).filter({ visible: true }).first()
  ).toBeVisible();
  return thread;
}

/** The text of the message `openThread` delivers under this subject. */
export function textOf(subject: string): string {
  return `${subject}.`;
}

/** Presses one of the message's own buttons, which show while it is hovered. */
export async function pressMessageButton(
  page: Page,
  subject: string,
  name: 'Reply' | 'Reply all' | 'Forward'
): Promise<void> {
  await page.getByText(textOf(subject)).first().hover();
  await page.getByRole('button', { name, exact: true }).click();
}

/** The one message the inbox sent with this subject, as the provider holds it. */
export async function sentCopy(
  mailbox: Mailbox,
  subject: string
): Promise<ReadMessage> {
  const sent = async () =>
    (await readMailbox(mailbox, mailbox.inbox.email)).filter(
      (message) =>
        message.subject === subject && message.from === mailbox.inbox.email
    );
  await expect
    .poll(async () => (await sent()).length, {
      message: `the provider never received "${subject}"`,
      timeout: 30_000,
    })
    .toBe(1);
  return (await sent())[0];
}

/** The row of the expanded reply envelope that holds a field's chips. */
export function envelopeRow(page: Page, label: 'To' | 'Cc' | 'Bcc'): Locator {
  return page
    .getByText(label, { exact: true })
    .locator('xpath=..')
    .filter({ has: page.getByRole('combobox') });
}

/** Whether `html` holds `text` as the first text inside a `tag` element. */
export function inside(html: string, tag: string, text: string): boolean {
  return new RegExp(`<${tag}\\b[^>]*>(?:\\s*<(?!/)[^>]*>)*${text}`).test(html);
}

/** Opens a thread from Xavier and presses its message's Reply (or Reply all). */
export async function replyTo(
  page: Page,
  mailbox: Mailbox,
  subject: string,
  options: { all?: boolean } = {}
): Promise<ThreadPreview> {
  const thread = await openThread(page, mailbox, subject, { cc: options.all });
  await pressMessageButton(page, subject, options.all ? 'Reply all' : 'Reply');
  await expect(page.getByRole('textbox', { name: /^Reply — / })).toBeVisible();
  return thread;
}

/** Presses Send and waits until the app says the email went out. */
export async function send(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send email' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Email sent' })
  ).toBeVisible();
}

/** Puts a file on the clipboard's way into an editor, as Ctrl+V does. */
export async function pasteFile(
  editor: Locator,
  file: { name: string; mimeType: string; base64: string }
): Promise<void> {
  await editor.evaluate((element, pasted) => {
    const bytes = Uint8Array.from(atob(pasted.base64), (char) =>
      char.charCodeAt(0)
    );
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([bytes], pasted.name, { type: pasted.mimeType })
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    );
  }, file);
}

/**
 * Stands in for the static file service, which the stack does not run (as
 * `draft-editor.spec.ts` does): it names an inline image and takes its
 * upload. Answers the uploads it took.
 */
export function stubStaticFiles(mailbox: Mailbox): string[] {
  const uploads: string[] = [];
  const stored = '/static-file/stored/picture';
  mailbox.front.stub(({ method, path }) => {
    if (method !== 'PUT') return undefined;
    if (path === '/static-file/api/file') {
      const location = `${mailbox.front.origin}${stored}`;
      return {
        json: { id: 'picture', upload_url: location, file_location: location },
      };
    }
    if (path === stored) {
      uploads.push(path);
      return { json: {} };
    }
    return undefined;
  });
  return uploads;
}

/** Whether the service holds a draft in the thread. */
export async function hasDraft(
  mailbox: Mailbox,
  threadId: string
): Promise<boolean> {
  const response = await mailbox.api(`/email/email/threads/${threadId}`);
  if (!response.ok)
    throw new Error(`no thread ${threadId}: ${response.status}`);
  const body = (await response.json()) as {
    thread: { messages: { is_draft: boolean }[] };
  };
  return body.thread.messages.some((message) => message.is_draft);
}
