import type {
  ImportEntity,
  ImportRun,
  ImportState,
} from '@service-cognition/import';
import { createSignal } from 'solid-js';
import { vi } from 'vitest';
import type {
  ConnectOutcome,
  ConnectorImportContext,
} from '../context/contracts';

export function importEntity(
  overrides: Partial<ImportEntity> & Pick<ImportEntity, 'id' | 'source'>
): ImportEntity {
  return {
    user_id: 'user',
    foreign_id: overrides.id,
    status: 'staged',
    initiator: 'manual',
    metadata: {},
    created_at: '2026-10-12T00:00:00Z',
    updated_at: '2026-10-12T00:00:00Z',
    ...overrides,
  };
}

export function importRunState(
  overrides: Partial<ImportRun> & Pick<ImportRun, 'source'>
): ImportRun {
  return {
    status: 'ready',
    auto_import: false,
    updated_at: '2026-10-12T00:00:00Z',
    ...overrides,
  };
}

/** An in-memory context whose server state tests drive directly. */
export function fakeConnectorImport(options?: { connected?: string[] }) {
  const [connected, setConnected] = createSignal<ReadonlySet<string>>(
    new Set(options?.connected)
  );
  const [state, setState] = createSignal<ImportState>({
    runs: [],
    entities: [],
  });
  const [ready, setReady] = createSignal(true);
  let connectOutcome: ConnectOutcome = 'connected';
  const context = {
    createConnections: () => ({ connected, ready: () => true }),
    createImportState: () => ({ state, ready }),
    connect: vi.fn(async (app: { appSlug: string }) => {
      if (connectOutcome === 'connected')
        setConnected((previous) => new Set([...previous, app.appSlug]));
      return connectOutcome;
    }),
    discover: vi.fn(async () => {}),
    runImport: vi.fn(async () => {}),
    startAgentImport: vi.fn(async () => {}),
    entityHref: (entity: { id: string; type: string }) =>
      `/app/${entity.type}/${entity.id}`,
  } satisfies ConnectorImportContext;
  return {
    context,
    setState,
    setReady,
    setConnectOutcome(outcome: ConnectOutcome) {
      connectOutcome = outcome;
    },
  };
}
