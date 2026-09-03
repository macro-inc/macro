import { createSignal } from 'solid-js';

/**
 * Optional path token after `settings/connections`. The split serializer
 * reads this the same way it reads `activeTabId`, so Discover and provider
 * pages can live in the URL without a new SettingsTab.
 */
export const [connectionsRest, setConnectionsRest] = createSignal<
  string | null
>(null);
