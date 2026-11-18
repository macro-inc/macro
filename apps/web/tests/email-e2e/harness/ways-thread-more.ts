// More of what the tests of the other ways into a thread's functions share,
// beside the frozen `ways-thread.ts`: the phone's thread address and header,
// and the reads of a thread still on their way.

import type { Locator, Page, Request } from '@playwright/test';

/** The address of a thread opened on a phone, where it opens as a block. */
export function openedOnPhone(threadId: string): RegExp {
  return new RegExp(`/app/email/${threadId}$`);
}

/**
 * Puts the keyboard in the open thread, as a click on its subject does: the
 * thread's container takes focus, inside the split's key scope. A row click
 * leaves the focus on the page body.
 */
export async function keyboardInThread(
  page: Page,
  subject: string
): Promise<void> {
  await page.getByRole('heading', { name: subject, level: 1 }).click();
}

/**
 * The subject in a phone's thread header: the text beside Info ("Show
 * details"), which is no button of its own (its island opens the thread's
 * menu). Back is there only when there is somewhere to go back to.
 */
export function phoneHeaderSubject(page: Page, subject: string): Locator {
  const header = page
    .locator('div')
    .filter({ has: page.getByRole('button', { name: 'Show details' }) })
    .filter({ hasText: subject })
    .last();
  return header.getByText(subject, { exact: true });
}

/**
 * Counts the page's reads of a thread's messages, and its mark-read writes,
 * that are still on their way. An open thread takes a scroll to its top only
 * once those are done: one made while it still reads its messages loads no
 * older ones, and nothing asks again. The count stays above zero for half
 * a second after the last of them, so that the gap between a read and the
 * write that follows it does not read as done.
 */
export function threadReadsInFlight(page: Page): () => number {
  const inFlight = new Set<Request>();
  let last = 0;
  const done = (request: Request) => {
    if (inFlight.delete(request)) last = Date.now();
  };
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const body = request.postData() ?? '';
    if (
      body.includes('"EmailThreadPage"') ||
      body.includes('"MarkEmailThreadSeen"')
    )
      inFlight.add(request);
  });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return () => inFlight.size || (Date.now() - last < 500 ? 1 : 0);
}
