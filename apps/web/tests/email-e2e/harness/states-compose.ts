// What the composer shows besides its happy path: requests held so that a
// passing state stays on screen, the toolbar's unnamed buttons, the phone's
// reply composer, and the same draft opened in a second browser.

import {
  type Browser,
  expect,
  type Locator,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';
import type { Mailbox, ThreadPreview } from './fixtures';
import { openThread, PHONE } from './ways-compose2';
import { anotherDevice, type OtherDevice } from './ways-send-more';

/** Requests held by `holdRequests`, let through by `release`. */
export type Held = { arrived: Promise<void>; release: () => Promise<void> };

/**
 * Holds every request `matches` accepts until `release`, so that the state
 * the page shows while it waits for the answer stays on screen.
 */
export async function holdRequests(
  page: Page,
  matches: (request: Request) => boolean
): Promise<Held> {
  const routes: Route[] = [];
  let released = false;
  let arrive = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  await page.route('**/*', async (route) => {
    if (released || !matches(route.request())) return route.fallback();
    routes.push(route);
    arrive();
  });
  return {
    arrived,
    release: async () => {
      released = true;
      await Promise.all(
        routes.map((route) => route.fallback().catch(() => {}))
      );
    },
  };
}

/** A request that confirms (PUT) or cancels (DELETE) a draft's send time. */
export function scheduleRequest(method: 'PUT' | 'DELETE') {
  return (request: Request): boolean =>
    request.method() === method &&
    /\/email\/drafts\/scheduled\/[^/?]+$/.test(new URL(request.url()).pathname);
}

/**
 * The buttons of the new-email toolbar, in order. Attach and the trash have
 * tooltips but no names: before a draft exists Attach is the first, and the
 * trash comes in front of it once there is one.
 */
export function toolbarButtons(page: Page): Locator {
  return page
    .getByRole('button', { name: 'Send email' })
    .locator('xpath=..')
    .locator('> button');
}

/**
 * The toolbar's Attach, pressed from the keyboard: resting the pointer on it
 * has been seen to crash the headless tab, so it is never hovered.
 */
export async function chooseFileToAttach(
  page: Page,
  attach: Locator,
  file: { name: string; mimeType: string; buffer: Buffer }
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await attach.focus();
  await page.keyboard.press('Enter');
  await (await chooser).setFiles(file);
}

/**
 * Moves a file from the desktop over an element without dropping it: the
 * drag events of `types`, in order (`dragenter`, `dragover`, `dragleave`).
 */
export async function dragFile(
  target: Locator,
  types: ('dragenter' | 'dragover' | 'dragleave' | 'drop')[]
): Promise<void> {
  await target.evaluate((element, events) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(['notes'], 'notes.txt', { type: 'text/plain' })
    );
    const box = element.getBoundingClientRect();
    for (const type of events) {
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
  }, types);
}

/** A tooltip on the screen, by the text it starts with. */
export function tooltip(page: Page, text: string): Locator {
  return page.getByRole('tooltip').filter({ hasText: text });
}

/**
 * Tells the page it is shown again, as switching back to its tab does:
 * what reads again on focus reads again now.
 */
export async function returnToTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Opens a thread on the phone and its full-screen reply composer. */
export async function phoneReply(
  page: Page,
  mailbox: Mailbox,
  subject: string
): Promise<{ thread: ThreadPreview; composer: Locator; editor: Locator }> {
  const thread = await openThread(page, mailbox, subject);
  expect(await page.evaluate(() => window.innerWidth)).toBe(
    PHONE.viewport.width
  );
  await page
    .locator('[data-mobile-dock-island]')
    .getByRole('button', { name: 'Reply', exact: true })
    .tap();
  const composer = page.getByRole('dialog', { name: 'Reply composer' });
  const editor = composer.getByRole('textbox', { name: /reference files/ });
  // The composer gives its editor the focus a moment after it opens: a field
  // used before then loses the focus to it mid-edit.
  await expect(editor).toBeFocused();
  return { thread, composer, editor };
}

/**
 * The same user in a second browser with the draft open, as opening it from
 * Drafts there does.
 */
export async function draftElsewhere(
  browser: Browser,
  mailbox: Mailbox,
  subject: string
): Promise<OtherDevice> {
  const other = await anotherDevice(browser, mailbox);
  await other.page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Drafts' })
    .click();
  await other.page
    .getByRole('grid', { name: 'Email' })
    .getByRole('row')
    .filter({ hasText: subject })
    .click();
  await expect(other.page.getByPlaceholder(/subject/i)).toHaveValue(subject);
  return other;
}
