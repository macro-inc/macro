import type { DialpadBackfill } from '@service-cognition/generated/schemas/dialpadBackfill';
import type { DialpadConnectionResponse } from '@service-cognition/generated/schemas/dialpadConnectionResponse';

export const DIALPAD_APP_SLUG = 'dialpad';
export const DIALPAD_DISPLAY_NAME = 'Dialpad';
/** Pipedream's directory logo for Dialpad (proxied by `PipedreamConnectorIcon`). */
export const DIALPAD_ICON_URL =
  'https://assets.pipedream.net/s.v0/app_X7LhyA/logo/orig';

/** How far back the first connect imports, in the order offered. */
export const DIALPAD_BACKFILL_OPTIONS: readonly {
  value: DialpadBackfill;
  label: string;
}[] = [
  { value: 'none', label: 'New calls only' },
  { value: 'week', label: 'Also import the last 7 days' },
  { value: 'month', label: 'Also import the last 30 days' },
  { value: 'quarter', label: 'Also import the last 90 days' },
];

/** Words for why sync needs attention; `undefined` when it does not. */
export function dialpadIssueLabel(
  connection: DialpadConnectionResponse
): string | undefined {
  switch (connection.issue) {
    case 'needs_reauth':
      return 'Reconnect needed';
    case 'setup_failed':
      return 'Setup failed';
    case 'stopped':
      return 'Stopped';
    case 'call_sync_failed':
      return 'Retrying';
    default:
      return undefined;
  }
}
