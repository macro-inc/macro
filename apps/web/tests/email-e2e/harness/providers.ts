// Tests that run once per provider: `for (const provider of PROVIDERS)`.

import type { Provider } from './stack';

export const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

/** "a Gmail inbox" or "an Outlook inbox", for test titles. */
export function anInbox(provider: Provider): string {
  return provider === 'GMAIL' ? 'a Gmail inbox' : 'an Outlook inbox';
}
