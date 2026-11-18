// What the fault tests (`ways-faults-*.spec.ts`) share: a received
// attachment filed into Drive the way the email service files it, a local
// cache that cannot start, and the composer's notices that recover a draft
// once a fault is lifted.

import { createHash } from 'node:crypto';
import type { Locator, Page, Route } from '@playwright/test';
import type { Mailbox } from './fixtures';

/** A file attached to a received message. */
export type ReceivedFile = {
  filename: string;
  mimeType: string;
  /** The Drive file type the copy gets. */
  fileType: string;
  text: string;
};

function quoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * Files a received attachment into the signed-in user's Drive and returns
 * the copy's document id. The email service files one by asking the storage
 * service's internal create to make a document for the attachment (which
 * links the two); the stack's email services send that request to a stand-in
 * that files nothing, so the test sends it to the real storage service for
 * them, with the same fields.
 */
export async function fileIntoDrive(
  mailbox: Mailbox,
  threadId: string,
  file: ReceivedFile
): Promise<string> {
  const rows = await mailbox.stack.sql<{ id: string }>(
    `SELECT a.id::text AS id FROM email_attachments a
     JOIN email_messages m ON m.id = a.message_id
     WHERE m.thread_id = ${quoted(threadId)}
       AND a.filename = ${quoted(file.filename)}`
  );
  const attachment = rows[0]?.id;
  if (!attachment) throw new Error(`no attachment ${file.filename}`);
  const response = await fetch(
    `${mailbox.stack.info.documentStorageUrl}/internal/documents`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth-key': mailbox.stack.info.internalApiKey,
        'x-internal-macro-user-id': mailbox.user.macroUserId,
      },
      body: JSON.stringify({
        sha: createHash('sha256').update(file.text).digest('hex'),
        documentName: file.filename.replace(/\.[^.]*$/, ''),
        fileType: file.fileType,
        mimeType: file.mimeType,
        emailAttachmentId: attachment,
        skipHistory: true,
      }),
    }
  );
  const text = await response.text();
  if (!response.ok)
    throw new Error(`filing ${file.filename} answered ${response.status}`);
  const created = JSON.parse(text) as {
    data: { documentMetadata: { documentId: string } };
  };
  return created.data.documentMetadata.documentId;
}

/** A tab of the email navigation. */
export function emailTab(page: Page, name: 'Inbox' | 'Drafts'): Locator {
  return page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name });
}

/** The composer's subject field. */
export function subjectField(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Subject' });
}

/** The notice a composer shows in place of a draft it cannot read. */
export function unreadable(
  page: Page,
  text: 'Unable to load this draft.' | 'Unable to load local draft.'
): Locator {
  return page.getByRole('alert').filter({ hasText: text });
}

/** The composer's banner asking for a reload to recover local storage. */
export function reloadBanner(page: Page): Locator {
  return page
    .getByRole('alert')
    .filter({ hasText: 'Update or reload Macro to recover local storage.' });
}

/**
 * Keeps the app's local cache from starting on the page's next load: the
 * worker that opens it cannot load, as when its script fails to download.
 * (A page route, so it runs before `loadAppSteadily`'s.) Returns what lets
 * it load again.
 */
export async function cacheWorkerUnloadable(
  page: Page
): Promise<{ lift: () => Promise<void> }> {
  const coordinator = /\/cache\.coordinator\.shared-worker-[^/]*\.js$/;
  const refuse = (route: Route) => route.abort();
  await page.route(coordinator, refuse);
  return { lift: () => page.unroute(coordinator, refuse) };
}
