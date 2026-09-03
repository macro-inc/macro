import { connectionsRest } from '@core/signal/connectionsRest';
import { activeTabId } from '@core/signal/settingsTab';
import {
  CONNECTIONS_TAB_SLUG,
  isConnectionsRestToken,
} from './settingsConnectionsUrl';
import { settingsTabToSlug } from './settingsTabsConfig';

export function settingsUrlSegments(): string[] {
  const slug = settingsTabToSlug(activeTabId());
  const rest = connectionsRest();
  if (slug === CONNECTIONS_TAB_SLUG && rest && isConnectionsRestToken(rest)) {
    return ['settings', slug, rest];
  }
  return ['settings', slug];
}
