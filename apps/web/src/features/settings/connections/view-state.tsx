import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { ProviderId } from './model';

export type ConnectionsMode = 'connected' | 'discover';

/** Navigation belongs to one mounted Agents Connections page, not global settings. */
export function createConnectionsViewState() {
  const [mode, setMode] = createSignal<ConnectionsMode>('connected');
  const [provider, setProvider] = createSignal<ProviderId | null>(null);
  return {
    mode,
    provider,
    showOverview: () => {
      setMode('connected');
      setProvider(null);
    },
    showDiscover: () => {
      setMode('discover');
      setProvider(null);
    },
    openProvider: (id: ProviderId) => setProvider(id),
    closeProvider: () => setProvider(null),
  };
}

const ConnectionsViewContext =
  createContext<ReturnType<typeof createConnectionsViewState>>();

export function ConnectionsViewProvider(
  props: ParentProps<{ value?: ReturnType<typeof createConnectionsViewState> }>
) {
  const value = props.value ?? createConnectionsViewState();
  return (
    <ConnectionsViewContext.Provider value={value}>
      {props.children}
    </ConnectionsViewContext.Provider>
  );
}

export function useConnectionsView() {
  const value = useContext(ConnectionsViewContext);
  if (!value) throw new Error('ConnectionsViewProvider is required');
  return value;
}
