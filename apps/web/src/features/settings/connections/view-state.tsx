import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { ProviderId } from './model';

/** Scope provider navigation to each mounted Integrations page. */
export function createConnectionsViewState(initial?: {
  provider?: ProviderId;
}) {
  const [provider, setProvider] = createSignal<ProviderId | null>(
    initial?.provider ?? null
  );
  return {
    provider,
    showOverview: () => {
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
