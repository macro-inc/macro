import type { ConnectorStatus } from '@queries/connectors';
import { match } from 'ts-pattern';

/** Granola's catalog app; connecting it is all the setup call import needs. */
export const GRANOLA_APP_SLUG = 'granola';
/** The directory's logo for Granola (proxied by `ConnectorIcon`). */
export const GRANOLA_ICON_URL =
  'https://assets.pipedream.net/s.v0/app_YMhwDy/logo/orig';

export type GranolaConnectionStatus =
  | 'connected'
  | 'disabled'
  | 'needs-reauth'
  | 'available';

/** An enabled connection syncs; a disabled one only needs re-enabling. */
export function granolaConnectionStatus(
  status: ConnectorStatus
): GranolaConnectionStatus {
  return match(status)
    .with('connected', () => 'connected' as const)
    .with('disabled', () => 'disabled' as const)
    .with('needsReauth', () => 'needs-reauth' as const)
    .with('notConnected', () => 'available' as const)
    .exhaustive(() => 'available' as const);
}
