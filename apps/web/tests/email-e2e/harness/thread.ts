// Threads of several messages, and the thread view's parts.

import type { Locator, Page } from '@playwright/test';
import { expect, type Mailbox, type ThreadPreview } from './fixtures';
import type { Mail } from './stack';

/** A message of a thread as the email service answers it. */
export type ThreadMessage = {
  db_id: string;
  is_draft: boolean;
  is_read: boolean;
  replying_to_id: string | null;
  body_text: string | null;
  [field: string]: unknown;
};

/**
 * Delivers `bodies.length` messages as one conversation, each a reply to the
 * one before, and waits until Macro holds them all. The thread is named after
 * its latest message: `Re: <subject>` once there is a reply.
 */
export async function deliverThread(
  mailbox: Mailbox,
  subject: string,
  bodies: (Pick<Mail, 'text' | 'html'> & Partial<Pick<Mail, 'from'>>)[]
): Promise<ThreadPreview> {
  const key = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  for (const [index, body] of bodies.entries()) {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      ...body,
      subject: index === 0 ? subject : `Re: ${subject}`,
      messageId: `${key}-${index + 1}@example.com`,
      inReplyTo: index === 0 ? undefined : `${key}-${index}@example.com`,
    });
  }
  const thread = await mailbox.synced(
    bodies.length > 1 ? `Re: ${subject}` : subject
  );
  await expect
    .poll(async () => (await threadMessages(mailbox, thread.id)).length)
    .toBe(bodies.length);
  return thread;
}

/** The thread's messages, drafts included, oldest first. */
export async function threadMessages(
  mailbox: Mailbox,
  threadId: string
): Promise<ThreadMessage[]> {
  const response = await mailbox.api(
    `/email/email/threads/${threadId}?limit=100`
  );
  const body = (await response.json()) as {
    thread?: { messages?: ThreadMessage[] };
  };
  return [...(body.thread?.messages ?? [])].reverse();
}

/** The card of the message whose text contains `text`. */
export function messageCard(page: Page, text: string): Locator {
  return page.locator('[data-message-body-id]').filter({ hasText: text });
}

/**
 * The bytes the email service answers for a received attachment of a thread,
 * by file name; undefined while the service does not answer them.
 */
export async function storedAttachment(
  mailbox: Mailbox,
  threadId: string,
  filename: string
): Promise<Buffer | undefined> {
  const thread = await mailbox.api(
    `/email/email/threads/${threadId}?limit=100`
  );
  if (!thread.ok) return undefined;
  const { thread: held } = (await thread.json()) as {
    thread?: {
      messages?: { attachments?: { db_id: string; filename: string }[] }[];
    };
  };
  const stored = (held?.messages ?? [])
    .flatMap((message) => message.attachments ?? [])
    .find((attachment) => attachment.filename === filename);
  if (!stored) return undefined;
  const answer = await mailbox.api(`/email/email/attachments/${stored.db_id}`);
  if (!answer.ok) return undefined;
  const { attachment } = (await answer.json()) as {
    attachment: { data_url?: string };
  };
  if (!attachment.data_url) return undefined;
  const file = await fetch(attachment.data_url);
  if (!file.ok) return undefined;
  return Buffer.from(await file.arrayBuffer());
}
