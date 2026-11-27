import type { Locator } from '@playwright/test';
import { literally } from './ways-organise-more';

/**
 * The desktop event composer folds its guests into a summary that names
 * them, then says what they may do. This is that summary when it names
 * exactly these guests, in this order.
 */
export function guestSummary(composer: Locator, guests: string[]): Locator {
  return composer.getByRole('button', {
    name: new RegExp(`^${guests.map(literally).join(', ')}(?: |$)`),
  });
}
