import { t } from '@app/lib/i18n';
import type { DialpadBackfill } from '@service-cognition/generated/schemas/dialpadBackfill';
import type { DialpadConnectionResponse } from '@service-cognition/generated/schemas/dialpadConnectionResponse';

export const DIALPAD_APP_SLUG = 'dialpad';
/** Pipedream's directory logo for Dialpad (proxied by `PipedreamConnectorIcon`). */
export const DIALPAD_ICON_URL =
  'https://assets.pipedream.net/s.v0/app_X7LhyA/logo/orig';

/** How far back the first connect imports, in the order offered. */
export const DIALPAD_BACKFILL_OPTIONS: readonly {
  value: DialpadBackfill;
  readonly label: string;
}[] = [
  {
    value: 'none',
    get label() {
      return t('dialpad.backfillNone');
    },
  },
  {
    value: 'week',
    get label() {
      return t('dialpad.backfillWeek');
    },
  },
  {
    value: 'month',
    get label() {
      return t('dialpad.backfillMonth');
    },
  },
  {
    value: 'quarter',
    get label() {
      return t('dialpad.backfillQuarter');
    },
  },
];

/** Words for why sync needs attention; `undefined` when it does not. */
export function dialpadIssueLabel(
  connection: DialpadConnectionResponse
): string | undefined {
  switch (connection.issue) {
    case 'needs_reauth':
      return t('dialpad.issueNeedsReauth');
    case 'setup_failed':
      return t('dialpad.issueSetupFailed');
    case 'setup_abandoned':
      return t('dialpad.issueSetupAbandoned');
    case 'stopped':
      return t('dialpad.issueStopped');
    case 'call_sync_failed':
      return t('dialpad.issueCallSyncFailed');
    case 'calls_abandoned':
      return t('dialpad.issueCallsAbandoned');
    case 'backfill_failed':
      return t('dialpad.issueBackfillFailed');
    default:
      return undefined;
  }
}
