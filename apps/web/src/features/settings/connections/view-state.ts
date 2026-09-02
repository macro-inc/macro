import { createSignal } from 'solid-js';
import type { ProviderId } from './model';

export type ConnectionsMode = 'connected' | 'discover';

const [connectionsMode, setConnectionsMode] =
  createSignal<ConnectionsMode>('connected');
const [connectionsProvider, setConnectionsProvider] =
  createSignal<ProviderId | null>(null);

export { connectionsMode, connectionsProvider };

export function showConnectionsOverview() {
  setConnectionsProvider(null);
  setConnectionsMode('connected');
}

export function showConnectionsDiscover() {
  setConnectionsProvider(null);
  setConnectionsMode('discover');
}

export function openConnectionsProvider(id: ProviderId) {
  setConnectionsProvider(id);
  setConnectionsMode('connected');
}
