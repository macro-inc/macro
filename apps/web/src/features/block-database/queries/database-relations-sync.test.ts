import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useRelatedDatabaseSync } from './database-relations-sync';

const mock = vi.hoisted(() => ({
  event: undefined as
    | ((message: { type: string; data: unknown }) => void)
    | undefined,
  refresh: undefined as (() => void) | undefined,
  subscribe: vi.fn(),
  invalidateDatabase: vi.fn(),
  invalidateRows: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: (handler: typeof mock.event) => {
    mock.event = handler;
  },
}));
vi.mock('@service-connection/client', () => ({
  useEntitySubscription: (entity: () => unknown, refresh: () => void) => {
    mock.subscribe(entity());
    mock.refresh = refresh;
  },
}));
vi.mock('@queries/storage/databases', () => ({
  invalidateDatabase: mock.invalidateDatabase,
  invalidateDatabaseRows: mock.invalidateRows,
}));

it('subscribes to an external related database and invalidates its rows on gateway change/reconnect', () => {
  const dispose = createRoot((dispose) => {
    useRelatedDatabaseSync('crm-db', () => ['customers']);
    return dispose;
  });
  expect(mock.subscribe).toHaveBeenCalledWith({
    entity_type: 'database',
    entity_id: 'crm-db',
  });
  mock.event?.({
    type: 'database_table_changed',
    data: { databaseId: 'support-db', tableId: 'tickets', version: 3 },
  });
  expect(mock.invalidateRows).not.toHaveBeenCalled();
  mock.event?.({
    type: 'database_table_changed',
    data: { databaseId: 'crm-db', tableId: 'customers', version: 4 },
  });
  expect(mock.invalidateDatabase).toHaveBeenCalledWith('crm-db');
  expect(mock.invalidateRows).toHaveBeenCalledWith('crm-db', 'customers');
  mock.invalidateRows.mockClear();
  mock.refresh?.();
  expect(mock.invalidateRows).toHaveBeenCalledWith('crm-db', 'customers');
  dispose();
});
