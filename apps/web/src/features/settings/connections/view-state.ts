import {
  connectionsProviderFromRest,
  connectionsRestForProvider,
  connectionsRestIsDiscoverReturn,
  isConnectionsProviderSlug,
} from '@core/constant/settingsConnectionsUrl';
import {
  connectionsRest,
  setConnectionsRest,
} from '@core/signal/connectionsRest';
import type { ProviderId } from './model';

export type ConnectionsMode = 'connected' | 'discover';

export function connectionsMode(): ConnectionsMode {
  return connectionsRest() === 'discover' ? 'discover' : 'connected';
}

export function connectionsProvider(): ProviderId | null {
  return connectionsProviderFromRest(connectionsRest());
}

export function showConnectionsOverview() {
  setConnectionsRest(null);
}

export function showConnectionsDiscover() {
  setConnectionsRest('discover');
}

export function openConnectionsProvider(id: ProviderId) {
  if (!isConnectionsProviderSlug(id)) return;
  const fromDiscover =
    connectionsRest() === 'discover' ||
    connectionsRestIsDiscoverReturn(connectionsRest());
  setConnectionsRest(connectionsRestForProvider(id, fromDiscover));
}

export function closeConnectionsProvider() {
  setConnectionsRest(
    connectionsRestIsDiscoverReturn(connectionsRest()) ? 'discover' : null
  );
}
