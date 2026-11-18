// Helpers for the second pass over the compose ways in. The first pass's
// helpers (ways-compose1.ts, ways-compose2.ts) are frozen; what they lack is
// here.

import type { Locator, Page } from '@playwright/test';
import { expect, type Mailbox, type ThreadPreview } from './fixtures';
import { pressMessageButton, textOf, XAVIER } from './ways-compose2';

/**
 * Delivers a message from Xavier whose text is its subject with a full stop
 * followed by `lines` numbered lines, opens its thread and presses Reply.
 * `openThread` delivers one line only, and a quote of one line never makes
 * the reply box overflow.
 */
export async function replyToLong(
  page: Page,
  mailbox: Mailbox,
  subject: string,
  lines: number
): Promise<ThreadPreview> {
  const body = Array.from({ length: lines }, (_, i) => `Point ${i + 1}.`);
  await mailbox.deliver({
    from: `Xavier <${XAVIER}>`,
    to: mailbox.inbox.email,
    subject,
    text: [textOf(subject), ...body].join('\n'),
  });
  const thread = await mailbox.synced(subject);
  await mailbox.open(`/app/mail/${thread.id}`);
  await expect(page.getByText(textOf(subject)).first()).toBeVisible();
  await pressMessageButton(page, subject, 'Reply');
  await expect(page.getByRole('textbox', { name: /^Reply — / })).toBeVisible();
  return thread;
}

/** The box a desktop reply's editor scrolls in, and its visible height. */
export function replyScrollBox(editor: Locator) {
  return {
    height: () =>
      editor.evaluate((element) => {
        const box = element.closest<HTMLElement>('[data-composer-scroll]');
        if (!box) throw new Error('the reply scrolls in nothing');
        return box.clientHeight;
      }),
    overflows: () =>
      editor.evaluate((element) => {
        const box = element.closest<HTMLElement>('[data-composer-scroll]');
        if (!box) throw new Error('the reply scrolls in nothing');
        return box.scrollHeight > box.clientHeight;
      }),
    scrollTop: () =>
      editor.evaluate(
        (element) =>
          element.closest<HTMLElement>('[data-composer-scroll]')?.scrollTop ??
          -1
      ),
  };
}

/**
 * Makes a markdown document of the signed-in user in the document storage
 * service, so that the @ menu can offer it. Answers its id.
 */
export async function createDocument(
  mailbox: Mailbox,
  name: string
): Promise<string> {
  const response = await mailbox.api('/dss/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The service names the upload by the content's SHA-256, in hex.
    body: JSON.stringify({
      documentName: name,
      sha: '0'.repeat(64),
      fileType: 'md',
    }),
  });
  if (!response.ok) throw new Error(`documents answered ${response.status}`);
  const { data } = (await response.json()) as {
    data: { documentMetadata: { documentId: string } };
  };
  return data.documentMetadata.documentId;
}

/** Takes a document's link share away: only its owner can open it. */
export async function makePrivate(
  mailbox: Mailbox,
  documentId: string
): Promise<void> {
  const response = await mailbox.api(`/dss/documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sharePermission: { linkShare: null, linkShareAccessLevel: null },
    }),
  });
  if (!response.ok) throw new Error(`the edit answered ${response.status}`);
}

/** Who may open a document by its link, and how. */
export async function linkShare(
  mailbox: Mailbox,
  documentId: string
): Promise<{ linkShare?: string; linkShareAccessLevel?: string }> {
  const response = await mailbox.api(
    `/dss/documents/${documentId}/permissions`
  );
  if (!response.ok) throw new Error(`permissions answered ${response.status}`);
  const { documentPermissions } = (await response.json()) as {
    documentPermissions: { linkShare?: string; linkShareAccessLevel?: string };
  };
  return {
    linkShare: documentPermissions.linkShare,
    linkShareAccessLevel: documentPermissions.linkShareAccessLevel,
  };
}

/**
 * The input of a phone recipient row. The phone labels its rows "To:",
 * "Cc:" and "Bcc:", and a folded row has no input at all, so counting
 * comboboxes finds the wrong one.
 */
export function phoneRecipientInput(
  page: Page,
  row: 'To' | 'Cc' | 'Bcc'
): Locator {
  return page
    .locator('div')
    .filter({ has: page.getByText(`${row}:`, { exact: true }) })
    .filter({ has: page.getByRole('combobox') })
    .last()
    .getByRole('combobox');
}
