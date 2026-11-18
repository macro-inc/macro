// The composer as a user drives it, and what Macro holds of its drafts.

import {
  expect,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { did } from '../ledger/record';
import type { Mailbox, ThreadPreview } from './fixtures';

/** The GraphQL operation a request to the document storage service carries. */
export function graphqlOperation(request: Request): string | undefined {
  if (request.method() !== 'POST') return undefined;
  if (!new URL(request.url()).pathname.endsWith('/graphql')) return undefined;
  return /"operationName":"(\w+)"/.exec(request.postData() ?? '')?.[1];
}

/** The draft saves the page sent, oldest first, with the HTML each carried. */
export function watchDraftSaves(
  page: Page
): { html: string; draftId: string }[] {
  const saves: { html: string; draftId: string }[] = [];
  page.on('request', (request) => {
    if (graphqlOperation(request) !== 'SaveEmailDraft') return;
    const { variables } = request.postDataJSON() as {
      variables: { input: { bodyHtml: string; draftId: string } };
    };
    saves.push({
      html: Buffer.from(variables.input.bodyHtml, 'base64url').toString('utf8'),
      draftId: variables.input.draftId,
    });
  });
  return saves;
}

/** Opens a new email and fills what a draft needs to be saved. */
export async function composeNew(
  page: Page,
  mailbox: Mailbox,
  mail: { to: string; subject: string; body: string }
): Promise<void> {
  await mailbox.open('/app/mail/new');
  did('AC-910');
  const to = page.getByRole('combobox').first();
  await to.fill(mail.to);
  await to.press('Enter');
  did('AC-003');
  await page.getByPlaceholder(/subject/i).fill(mail.subject);
  did('AC-018');
  await body(page).click();
  await page.keyboard.type(mail.body);
  did('AC-911');
  did('AC-022');
}

/** The composer's message body. */
export function body(page: Page): Locator {
  return page.locator('[contenteditable="true"]').last();
}

/** The id of the draft the compose route shows, once the server confirmed it. */
export async function routeDraftId(page: Page): Promise<string> {
  await expect(page).toHaveURL(/email-compose\.draft=[0-9a-f-]{36}/);
  return new URL(page.url()).searchParams.get(
    's0.email-compose.draft'
  ) as string;
}

// Attach and the trash have tooltips but no names. Once the composer has a
// draft they are the first two buttons of the row that ends in Send.
function toolbarButton(page: Page, index: number): Locator {
  return page
    .getByRole('button', { name: 'Send email' })
    .locator('xpath=..')
    .locator('> button')
    .nth(index);
}

/** The toolbar's trash, shown once the composer has a draft. */
export function discardButton(page: Page): Locator {
  return toolbarButton(page, 0);
}

/** The toolbar's paperclip, of a composer that has a draft. */
export function attachButton(page: Page): Locator {
  return toolbarButton(page, 1);
}

/**
 * Carries the page's uploads to the stack's object storage. The storage
 * double answers no CORS headers, so the browser would refuse its answers;
 * the test process sends each upload instead and hands the answer back.
 * `hold` keeps every upload unanswered until it resolves.
 */
export async function relayUploads(
  page: Page,
  hold: Promise<void> = Promise.resolve()
): Promise<void> {
  await page.route(/\/email-attachments\//, async (route) => {
    await hold;
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'access-control-allow-origin': '*',
        'access-control-expose-headers': '*',
      },
    });
  });
}

/** Attaches a file through the picker the paperclip opens. */
export async function attach(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer }
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await attachButton(page).click();
  await (await chooser).setFiles(file);
  did('AC-024');
}

/** The threads Macro lists under Drafts for any of the user's inboxes. */
export async function draftThreads(mailbox: Mailbox): Promise<ThreadPreview[]> {
  const response = await mailbox.api(
    '/email/email/threads/previews/cursor/drafts?limit=100'
  );
  if (!response.ok) throw new Error(`drafts answered ${response.status}`);
  return ((await response.json()) as { items: ThreadPreview[] }).items;
}

/** Drops a file from the desktop onto an element. */
export async function dropFile(
  target: Locator,
  file: { name: string; mimeType: string; base64: string }
): Promise<void> {
  await target.evaluate((element, dropped) => {
    const bytes = Uint8Array.from(atob(dropped.base64), (char) =>
      char.charCodeAt(0)
    );
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([bytes], dropped.name, { type: dropped.mimeType })
    );
    const box = element.getBoundingClientRect();
    for (const type of ['dragenter', 'dragover', 'drop']) {
      element.dispatchEvent(
        new DragEvent(type, {
          dataTransfer,
          bubbles: true,
          cancelable: true,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
        })
      );
    }
  }, file);
}

/**
 * Chrome fails every request in flight when the machine's network changes,
 * which other stacks starting on it cause, and a page caught loading is left
 * without part of the app. The app's own files are fetched by the test
 * process instead, which no such change reaches.
 */
export async function loadAppSteadily(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/app/'),
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // A fetch the test's end interrupts, or one the test process cannot
      // make, is left to the browser.
      try {
        const response = await route.fetch();
        await route.fulfill({ response });
      } catch {
        await route.fallback().catch(() => {});
      }
    }
  );
}
