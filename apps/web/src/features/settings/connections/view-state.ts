import { isConnectionsProviderSlug } from '@core/constant/settingsConnectionsUrl';
import { connectionsRest, setConnectionsRest } from '@core/signal/connectionsRest';
import { createSignal } from 'solid-js';
import type { ProviderId } from './model';

export type ConnectionsMode = 'connected' | 'discover';

const [returnMode, setReturnMode] = createSignal<ConnectionsMode>('connected');

export function connectionsMode(): ConnectionsMode {
  const rest = connectionsRest();
  if (rest === 'discover') return 'discover';
  if (rest) return returnMode();
  return 'connected';
}

export function connectionsProvider(): ProviderId | null {
  const rest = connectionsRest();
  return rest && isConnectionsProviderSlug(rest) ? rest : null;
}

export function showConnectionsOverview() {
  setConnectionsRest(null);
  setReturnMode('connected');
}

export function showConnectionsDiscover() {
  setConnectionsRest('discover');
  setReturnMode('discover');
}

export function openConnectionsProvider(id: ProviderId) {
  setReturnMode(connectionsRest() === 'discover' ? 'discover' : 'connected');
  setConnectionsRest(id);
}

export function closeConnectionsProvider() {
  setConnectionsRest(returnMode() === 'discover' ? 'discover' : null);
}
