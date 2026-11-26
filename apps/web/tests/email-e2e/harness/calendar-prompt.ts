import type { Page } from '@playwright/test';
import type { EmailStack, SignedInUser } from './stack';

const DISMISSED = 'macro:calendar-prompt:dismissed';

/**
 * Stack inboxes grant mail alone, so the app asks to enable each of the
 * person's inboxes' calendars in a toast that covers the composer and steals
 * focus. Store each own inbox as dismissed before the app reads it, as for a
 * person who said "Not now", including inboxes the test links later.
 */
export async function keepCalendarPromptsClosed(
  page: Page,
  stack: EmailStack,
  user: SignedInUser,
  linkIds: string[]
): Promise<void> {
  const ids = [...linkIds];
  const remember = async () => {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [DISMISSED, JSON.stringify(ids)] as const
    );
  };
  const link = stack.link.bind(stack);
  stack.link = async (who, ...rest) => {
    const linked = await link(who, ...rest);
    if (who.email === user.email) {
      ids.push(linked.linkId);
      await remember();
    }
    return linked;
  };
  await remember();
}

/** For a second browser of the same person, who closed the prompt there too. */
export async function keepCalendarPromptClosed(
  page: Page,
  linkId: string
): Promise<void> {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    DISMISSED,
    JSON.stringify([linkId]),
  ] as const);
}
