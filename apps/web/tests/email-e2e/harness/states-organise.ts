// What the tests of the organise states share: a request of the app held
// until the test lets it go, or refused; a thread without a subject; a
// mention of a thread from elsewhere; and where the thread's controls are.

import type { Locator, Page, Request, Route } from '@playwright/test';
import { expect, type Mailbox } from './fixtures';

/** Which of the requests a route sees are the ones to act on. */
type Matches = (request: Request) => boolean;

/** Requests of one method. */
export function method(name: string): Matches {
  return (request) => request.method() === name;
}

/** A PATCH of a thread's state that sets `field` to `value`. */
export function stateWrite(field: string, value: boolean): Matches {
  return (request) => {
    if (request.method() !== 'PATCH') return false;
    const body = request.postDataJSON() as { field?: string; value?: boolean };
    return body.field === field && body.value === value;
  };
}

/** The app's write of a thread's state (Trash, Spam, their restores). */
export const THREAD_STATE = '**/email/threads/*/state';

const REFUSAL = {
  status: 500,
  contentType: 'application/json',
  body: JSON.stringify({ message: 'refused' }),
};

/**
 * Holds the matching requests until `release`, which lets them (and every
 * later one) go on, or answers them with a refusal.
 */
export async function hold(
  page: Page,
  url: string | RegExp,
  matches: Matches = () => true
): Promise<{
  held: () => number;
  release: (answer?: 'refuse') => Promise<void>;
}> {
  const held: Route[] = [];
  let released = false;
  await page.route(url, async (route) => {
    if (released || !matches(route.request())) {
      await route.fallback();
      return;
    }
    held.push(route);
  });
  return {
    held: () => held.length,
    release: async (answer) => {
      released = true;
      for (const route of held.splice(0)) {
        if (answer === 'refuse') await route.fulfill(REFUSAL);
        else await route.fallback();
      }
    },
  };
}

/** Refuses the matching requests with a 500 while `refusing` says so. */
export async function refuse(
  page: Page,
  url: string | RegExp,
  matches: Matches = () => true,
  refusing: () => boolean = () => true
): Promise<void> {
  await page.route(url, async (route) => {
    if (refusing() && matches(route.request())) await route.fulfill(REFUSAL);
    else await route.fallback();
  });
}

/** The storage service's reminder of one thread (read and set). */
export function reminderOf(threadId: string): RegExp {
  return new RegExp(`/reminders/email/${threadId}$`);
}

/** The natural-time reader the Remind me menu reads typed times with. */
export const NATURAL_TIME_WASM = '**/natural_time_bg-*.wasm';

/**
 * Delivers a message with no subject and answers the id of its thread once
 * Macro lists it (the list has no subject to find it by).
 */
export async function deliverWithoutSubject(
  mailbox: Mailbox,
  text: string
): Promise<string> {
  await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject: '',
    text,
  });
  let id = '';
  await expect
    .poll(
      async () => {
        const response = await mailbox.api(
          '/email/email/threads/previews/cursor/all?limit=100'
        );
        const { items } = (await response.json()) as {
          items: { id: string; name: string | null }[];
        };
        id = items.find((item) => !item.name)?.id ?? '';
        return id;
      },
      { message: 'Macro never listed the thread without a subject' }
    )
    .not.toBe('');
  return id;
}

/**
 * Records that a document mentions the thread, as the storage service does
 * when one is saved with a link to it: the stack runs no document editor.
 */
export async function mentionInDocument(
  mailbox: Mailbox,
  threadId: string
): Promise<void> {
  await mailbox.stack.sql(
    `INSERT INTO comms_entity_mentions (source_entity_type, source_entity_id, entity_type, entity_id, user_id)
     VALUES ('document', '${crypto.randomUUID()}', 'email_thread', '${threadId}', '${mailbox.user.macroUserId}')
     RETURNING id`
  );
}

/** The buttons of an open thread's header for read, done and Remind me. */
export function threadActions(page: Page): Locator {
  return page.getByRole('group', { name: 'Email actions' });
}

/** The thread's side panel on a desktop. */
export function sidePanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Block details' });
}

/** The Remind me menu. */
export function remindMenu(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Remind me' });
}

/**
 * Waits for the desktop's notices to time out, with the pointer and the
 * focus (each of which keeps them on screen) off them. The desktop stacks
 * its notices, and a stack that grows under the pointer can move an Undo
 * away from the click: an Undo is pressed with its notice alone on screen.
 */
export async function noticesGone(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await expect(
    page.getByRole('region', { name: /^Notifications/ }).getByRole('status')
  ).toHaveCount(0);
}

/**
 * Waits for a phone sheet to have slid all the way in: one acted on in the
 * frame its slide starts stays on the page (handoff
 * phone-sheet-closed-while-opening-stays).
 */
export async function sheetIn(sheet: Locator): Promise<void> {
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).not.toHaveAttribute('data-transitioning');
}
