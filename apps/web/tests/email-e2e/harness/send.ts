// What the send tests share: driving the thread's composer like a user,
// provider faults, and reading a sent message the way its recipient gets it.

import { expect, type Locator, type Page } from '@playwright/test';
import { did } from '../ledger/record';
import type { Mailbox } from './fixtures';
import { rawMessage } from './provider';
import type { LinkedInbox, ProviderMessage } from './stack';

/** Makes the provider answer an error on a route (`messages.send`). */
export async function injectFault(
  mailbox: Mailbox,
  fault: { route: string; error: string; times?: number }
): Promise<void> {
  const base =
    mailbox.inbox.provider === 'GMAIL'
      ? mailbox.stack.info.gmailUrl
      : mailbox.stack.info.outlookUrl;
  const response = await fetch(`${base}/_emulator/faults`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fault),
  });
  if (!response.ok) {
    throw new Error(
      `fault refused: ${response.status} ${await response.text()}`
    );
  }
}

/** A notice the app shows in the corner (`Sending…`, `Email sent`). */
export function notice(page: Page, text: string | RegExp): Locator {
  return page.getByRole('status').filter({ hasText: text });
}

/** The editor of the composer open in the thread. */
export function replyEditor(page: Page): Locator {
  return page.getByRole('textbox', { name: /^(Reply|Forward) — / });
}

/**
 * Opens the composer from a message's own Reply (0) or Forward (1) button.
 * They carry no name, only a tooltip, so they are found by their place next
 * to the message's date.
 */
export async function messageAction(
  page: Page,
  messageText: string,
  action: 'reply' | 'forward'
): Promise<void> {
  await page.getByText(messageText).first().hover();
  await page
    .locator('main .gap-0\\.5 > button')
    .nth(action === 'reply' ? 0 : 1)
    .click();
  if (action === 'reply') {
    did('AL-168');
  } else {
    did('AL-170');
  }
}

/** The messages the mailbox holds in Sent at the provider. */
export async function sentMessages(
  mailbox: Mailbox,
  inbox: LinkedInbox = mailbox.inbox
): Promise<ProviderMessage[]> {
  const sent = inbox.provider === 'GMAIL' ? 'SENT' : 'Sent Items';
  return (await mailbox.stack.providerMessages(inbox.email)).filter((message) =>
    message.labels.includes(sent)
  );
}

/** Waits for the one message the mailbox sent and answers it as RFC 822. */
export async function onlySentRaw(
  mailbox: Mailbox,
  inbox: LinkedInbox = mailbox.inbox
): Promise<string> {
  await expect
    .poll(async () => (await sentMessages(mailbox, inbox)).length, {
      message: 'the provider never received the send',
      timeout: 30_000,
    })
    .toBe(1);
  const [sent] = await sentMessages(mailbox, inbox);
  return rawMessage(mailbox.stack.info, inbox.provider, inbox.email, sent.id);
}

function decodeQuotedPrintable(text: string): string {
  const bytes: number[] = [];
  const joined = text.replace(/=\r?\n/g, '');
  for (let index = 0; index < joined.length; index++) {
    const hex = joined.slice(index + 1, index + 3);
    if (joined[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(joined[index], 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The HTML body of an RFC 822 message, as the recipient's client reads it. */
export function htmlBody(raw: string): string {
  const part = raw
    .split(/\r?\n--[^\r\n]+/)
    .find((candidate) => /content-type:\s*text\/html/i.test(candidate));
  if (!part) throw new Error('the message has no HTML part');
  const [head, ...body] = part.split(/\r?\n\r?\n/);
  const text = body.join('\n\n');
  return /quoted-printable/i.test(head) ? decodeQuotedPrintable(text) : text;
}

/** How many times `needle` occurs in `text`. */
export function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

async function gmailToken(mailbox: Mailbox, email: string): Promise<string> {
  const response = await fetch(
    `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(email)}/access-tokens`,
    { method: 'POST' }
  );
  if (!response.ok) throw new Error(`no Gmail token: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

/**
 * Saves a draft in the mailbox at Gmail, the way another mail client does:
 * `raw` is the RFC 822 message, `threadId` the provider's thread it answers.
 */
export async function gmailSaveDraft(
  mailbox: Mailbox,
  draft: { threadId: string; raw: string }
): Promise<void> {
  const token = await gmailToken(mailbox, mailbox.inbox.email);
  const response = await fetch(
    `${mailbox.stack.info.gmailUrl}/gmail/v1/users/me/drafts`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          threadId: draft.threadId,
          raw: Buffer.from(draft.raw, 'utf8').toString('base64url'),
        },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Gmail refused the draft: ${response.status} ${await response.text()}`
    );
  }
}

/** A message of a thread as the email service answers it. */
export type ThreadMessage = {
  db_id: string;
  is_draft: boolean;
  subject: string | null;
  body_text: string | null;
  body_html_sanitized: string | null;
  to: { email: string }[];
  cc: { email: string }[];
  attachments_draft?: unknown[];
  [field: string]: unknown;
};

/** The thread's messages, read as the owner of `inbox`. */
export async function threadMessages(
  mailbox: Mailbox,
  threadId: string,
  inbox: LinkedInbox = mailbox.inbox
): Promise<ThreadMessage[]> {
  const response = await mailbox.api(`/email/email/threads/${threadId}`, {
    headers: { 'x-email-link-id': inbox.linkId },
  });
  if (!response.ok)
    throw new Error(`no thread ${threadId}: ${response.status}`);
  const body = (await response.json()) as {
    thread: { messages: ThreadMessage[] };
  };
  return body.thread.messages;
}

/** Puts text on the clipboard's way into the focused editor, as Ctrl+V does. */
export async function paste(editor: Locator, text: string): Promise<void> {
  await editor.evaluate((element, pasted) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', pasted);
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    );
  }, text);
}

/** Waits until Macro has synced a thread with this subject into `inbox`. */
export async function syncedIn(
  mailbox: Mailbox,
  inbox: LinkedInbox,
  subject: string
): Promise<{ id: string }> {
  let found: { id: string; name: string } | undefined;
  await expect
    .poll(
      async () => {
        const response = await mailbox.api(
          '/email/email/threads/previews/cursor/all?limit=100',
          { headers: { 'x-email-link-id': inbox.linkId } }
        );
        const page = (await response.json()) as {
          items: { id: string; name: string }[];
        };
        found = page.items.find((item) => item.name === subject);
        return found !== undefined;
      },
      { message: `Macro never synced "${subject}"`, timeout: 60_000 }
    )
    .toBe(true);
  return found as { id: string };
}

/** Attaches a file through the composer's Attach button. */
export async function attach(
  page: Page,
  file: { name: string; mimeType: string; text: string }
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  // Attach has only a tooltip; it is the button before Create event.
  await page
    .getByRole('button', { name: 'Create event' })
    .locator('xpath=preceding::button[1]')
    .click();
  await (await chooser).setFiles({
    name: file.name,
    mimeType: file.mimeType,
    buffer: Buffer.from(file.text, 'utf8'),
  });
}
