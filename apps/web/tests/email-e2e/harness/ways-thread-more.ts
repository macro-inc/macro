// More of what the tests of the other ways into a thread's functions share,
// beside the frozen `ways-thread.ts`: the phone's thread address and header.

import type { Locator, Page } from '@playwright/test';

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
