import type { Harness as RegisteredHarness } from '@service-storage/client';

/** Where the bring-your-own-agent (macrod) setup is documented. */
export const BYOA_DOCS_URL = 'https://docs.macro.com/AI/bring-your-own';

/** When a paired runtime's daemon last held a connection. */
export function lastConnectedText(harness: RegisteredHarness): string {
  return harness.last_connected_at
    ? `Last connected ${new Date(harness.last_connected_at).toLocaleString()}`
    : 'Never connected';
}
