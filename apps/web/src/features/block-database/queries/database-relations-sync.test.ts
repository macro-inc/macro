import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useRelatedDatabaseSync } from './database-relations-sync';

const mock = vi.hoisted(() => ({
  events: [] as ((message: { type: string; data: unknown }) => void)[],
  refresh: undefined as (() => void) | undefined,
  subscribe: vi.fn(),
  invalidateDatabase: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: (handler: (typeof mock.events)[number]) => {
    mock.events.push(handler);
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
}));

it('subscribes to an external related database, re-reads its schema on gateway change and its rows on reconnect', () => {
  const refreshRows = vi.fn();
  const dispose = createRoot((dispose) => {
    useRelatedDatabaseSync('crm-db', refreshRows);
    return dispose;
  });
  expect(mock.subscribe).toHaveBeenCalledWith({
    entity_type: 'database',
    entity_id: 'crm-db',
  });
  for (const handler of mock.events)
    handler({
      type: 'database_table_changed',
      data: { databaseId: 'support-db', tableId: 'tickets', version: 3 },
    });
  expect(mock.invalidateDatabase).not.toHaveBeenCalled();
  for (const handler of mock.events)
    handler({
      type: 'database_table_changed',
      data: { databaseId: 'crm-db', tableId: 'customers', version: 4 },
    });
  expect(mock.invalidateDatabase).toHaveBeenCalledWith('crm-db');
  expect(refreshRows).not.toHaveBeenCalled();
  mock.refresh?.();
  expect(refreshRows).toHaveBeenCalledOnce();
  dispose();
});
