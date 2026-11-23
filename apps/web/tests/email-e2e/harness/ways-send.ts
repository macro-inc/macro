// What the send ways-in tests share: the schedule Macro holds, and the
// composer's clock as a user drives it.

import { expect, type Locator, type Page } from '@playwright/test';
import type { Mailbox } from './fixtures';

/** A message Macro holds to send later. */
export type Scheduled = { db_id: string; scheduled_send_time: string };

/** The messages Macro holds to send later. */
export async function scheduled(mailbox: Mailbox): Promise<Scheduled[]> {
  const response = await mailbox.api(
    '/email/email/drafts/scheduled?offset=0&limit=100'
  );
  if (!response.ok) throw new Error(`scheduled answered ${response.status}`);
  return ((await response.json()) as { messages: Scheduled[] }).messages;
}

/** The times Macro holds messages for, as local dates, earliest first. */
export async function scheduledTimes(mailbox: Mailbox): Promise<string[]> {
  return (await scheduled(mailbox))
    .map((message) => new Date(message.scheduled_send_time).toString())
    .sort((a, b) => Date.parse(a) - Date.parse(b));
}

/** Eight in the morning, `days` days from today: what a preset stands for. */
export function morningIn(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(8, 0, 0, 0);
  return date;
}

/** The day each preset of the picker stands for, counted from today. */
export const PRESET_DAYS: Record<string, number> = {
  Today: 0,
  Tomorrow: 1,
  'In 2 days': 2,
};

/** The composer's clock while no time is confirmed. */
export function clock(scope: Page | Locator): Locator {
  return scope.getByRole('button', {
    name: /^(Choose send time|Send time set to )/,
  });
}

/** The clock of a message Macro already holds for later. */
export function scheduledClock(scope: Page | Locator): Locator {
  return scope.getByRole('button', {
    name: /^(Scheduled for |Proposed send time )/,
  });
}

/** Opens a clock's picker and waits for its options. */
export async function openPicker(page: Page, trigger: Locator): Promise<void> {
  await trigger.click();
  await expect(page.getByRole('option').first()).toBeVisible();
}

/** The option of the open picker with this label (`Tomorrow`). */
export function preset(page: Page, label: string): Locator {
  return page.getByRole('option', { name: new RegExp(`^${label}`) });
}

/** The corner notice that a message is held for later, by its name. */
export function scheduledNotice(page: Page): Locator {
  return page.getByRole('status', { name: 'Email scheduled', exact: true });
}

/**
 * The schedule bar's button. The Send button's tooltip covers the bar while
 * the pointer rests on Send, so the pointer is moved away first.
 */
export async function barButton(page: Page, name: string): Promise<Locator> {
  await page.mouse.move(0, 0);
  return page.getByRole('button', { name, exact: true });
}
