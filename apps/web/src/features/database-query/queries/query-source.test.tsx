import { databaseQueryKeys } from '@queries/storage/keys';
import type { DatabaseDetail, ExecOutcome } from '@service-storage/databases';
import { render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryFocusTable, queryStarters } from '../core/query';
import { createLiveQuerySource, toQuerySchema } from './query-source';

const outcome: ExecOutcome = {
  results: [],
  changes_applied: 0,
  inserted_row_ids: [],
  new_versions: {},
  read_tables: ['watched'],
  read_versions: { watched: 4 },
  truncated_tables: [],
};
afterEach(() => vi.useRealTimers());
describe('query schema', () => {
  it('uses immutable read aliases while preserving human table names and older-server support', () => {
    const detail: DatabaseDetail = {
      database: {
        id: 'db',
        name: 'Renamed database',
        owner_id: 'owner',
        created_at: '',
        trashed_at: null,
      },
      grant: 'owner',
      tables: [
        {
          table: {
            id: 'legacy',
            database_id: 'db',
            name: 'Projects',
            position: 'a',
            version: 1,
          },
          sql_name: 'projects',
          columns: [],
        },
        {
          table: {
            id: 'contacts',
            database_id: 'db',
            name: 'Contacts',
            position: 'b',
            version: 1,
          },
          sql_name: 'contacts',
          read_sql_name: 'stable_contacts_uuid',
          columns: [],
        },
      ],
    };
    const schema = toQuerySchema(detail, 'contacts');
    expect(queryFocusTable(schema)?.name).toBe('Contacts');
    expect(queryFocusTable(schema)?.sqlName).toBe('stable_contacts_uuid');
    expect(queryStarters(schema)[0]).toMatchObject({
      prompt: 'How many records are in Contacts?',
      sql: 'SELECT COUNT(*) AS "Total records" FROM "stable_contacts_uuid"',
    });
    expect(schema.tables[0].sqlName).toBe('projects');
    expect(detail.tables[1].sql_name).toBe('contacts');
  });
});

describe('live query source', () => {
  it('recovers from a failed refresh when a newer dependency event arrives', async () => {
    const read = vi
      .fn<() => Promise<ExecOutcome>>()
      .mockResolvedValueOnce(outcome)
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValue({ ...outcome, read_versions: { watched: 6 } });
    let emit!: (tableId: string, version: number) => void;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Harness() {
      const query = createLiveQuerySource({
        sql: () => 'SELECT COUNT(*) FROM projects',
        read,
        subscribe: (callback) => {
          emit = callback;
        },
      });
      return <div>{query.status}</div>;
    }
    const result = render(() => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ));
    await result.findByText('success');
    emit('watched', 5);
    await result.findByText('error');
    emit('watched', 6);
    await result.findByText('success');
    expect(read).toHaveBeenCalledTimes(3);
    result.unmount();
    client.clear();
  });

  it('coalesces newer dependency events and releases pending refreshes on unmount', async () => {
    const read = vi.fn(async () => outcome);
    let emit!: (tableId: string, version: number) => void;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Harness() {
      createLiveQuerySource({
        sql: () => 'SELECT 1',
        read,
        subscribe: (callback) => {
          emit = callback;
        },
      });
      return null;
    }
    const result = render(() => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ));
    await waitFor(() =>
      expect(
        client.getQueryData(databaseQueryKeys.answer('SELECT 1').queryKey)
      ).toEqual(outcome)
    );
    vi.useFakeTimers();
    emit('other', 9);
    emit('watched', 4);
    await vi.advanceTimersByTimeAsync(350);
    expect(read).toHaveBeenCalledTimes(1);
    emit('watched', 5);
    emit('watched', 6);
    await vi.advanceTimersByTimeAsync(299);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    emit('watched', 7);
    result.unmount();
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(2);
    client.clear();
  });
});
