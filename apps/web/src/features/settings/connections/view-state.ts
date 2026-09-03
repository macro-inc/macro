import { createSignal } from 'solid-js';
import type { ProviderId } from './model';

export type ConnectionsMode = 'connected' | 'discover';

const [connectionsMode, setConnectionsMode] =
  createSignal<ConnectionsMode>('connected');
const [connectionsProvider, setConnectionsProvider] =
  createSignal<ProviderId | null>(null);
const [returnMode, setReturnMode] = createSignal<ConnectionsMode>('connected');

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
  setReturnMode(connectionsMode());
  setConnectionsProvider(id);
}

export function closeConnectionsProvider() {
  setConnectionsProvider(null);
  setConnectionsMode(returnMode());
}
