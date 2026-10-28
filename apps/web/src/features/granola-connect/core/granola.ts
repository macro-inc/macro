/** Granola's Pipedream app; connecting it is all the setup call import needs. */
export const GRANOLA_APP_SLUG = 'granola';
export const GRANOLA_DISPLAY_NAME = 'Granola';
/** Pipedream's directory logo for Granola (proxied by `PipedreamConnectorIcon`). */
export const GRANOLA_ICON_URL =
  'https://assets.pipedream.net/s.v0/app_YMhwDy/logo/orig';

export type GranolaConnectionStatus = 'connected' | 'disabled' | 'available';

/** An enabled connection syncs; a disabled one only needs re-enabling. */
export function granolaConnectionStatus(
  connections: readonly { app_slug: string; enabled: boolean }[]
): GranolaConnectionStatus {
  const granola = connections.filter((c) => c.app_slug === GRANOLA_APP_SLUG);
  if (granola.some((c) => c.enabled)) return 'connected';
  return granola.length ? 'disabled' : 'available';
}
