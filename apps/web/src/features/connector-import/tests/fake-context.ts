import { createSignal } from 'solid-js';
import { vi } from 'vitest';
import type {
  ConnectOutcome,
  ConnectorImportContext,
} from '../context/contracts';

/**
 * An in-memory context whose connections tests drive directly. Every
 * connected app can be imported from unless listed in `withoutImport`.
 */
export function fakeConnectorImport(options?: {
  connected?: string[];
  withoutImport?: string[];
}) {
  const [connected, setConnected] = createSignal<ReadonlySet<string>>(
    new Set(options?.connected)
  );
  const importable = () =>
    new Set(
      [...connected()].filter((slug) => !options?.withoutImport?.includes(slug))
    );
  let connectOutcome: ConnectOutcome = 'connected';
  const context = {
    createConnections: () => ({ connected, importable, ready: () => true }),
    connect: vi.fn(async (app: { appSlug: string }) => {
      if (connectOutcome === 'connected')
        setConnected((previous) => new Set([...previous, app.appSlug]));
      return connectOutcome;
    }),
    startAgentImport: vi.fn(async () => {}),
  } satisfies ConnectorImportContext;
  return {
    context,
    setConnected,
    setConnectOutcome(outcome: ConnectOutcome) {
      connectOutcome = outcome;
    },
  };
}
