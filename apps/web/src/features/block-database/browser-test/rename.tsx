import '@app/index.css';
import { queryClient } from '@queries/client';
import { useDatabaseDetailQuery } from '@queries/storage/databases';
import { QueryClientProvider } from '@tanstack/solid-query';
import { okAsync } from 'neverthrow';
import { Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { DatabaseProvider } from '../../database/context/database';
import { DatabaseRecords } from '../../database/views/database-records';
import { createMacroDatabaseApi, editorTable } from '../queries/editor-api';

// Real schema query, mutation adapter, controller and headers; only row reads
// are local. Playwright intercepts the schema service to control response order.
function RenameFixture() {
  const detail = useDatabaseDetailQuery(() => 'db');
  const table = () =>
    detail.isSuccess ? editorTable(detail.data.tables[0]) : undefined;
  const view = {
    query: { filter: null },
    layout: { kind: 'table' as const, columns: [] },
  };
  return (
    <main class="flex h-screen flex-col bg-panel text-ink">
      <div class="p-4 text-lg">Planning</div>
      <Show when={table()}>
        {(_schema) => (
          <DatabaseProvider
            api={createMacroDatabaseApi('db', queryClient)}
            tableId="tasks"
            view={view}
            capabilities={{ editRows: true, editColumns: true }}
            data={{
              table,
              rows: {
                columns: () => table()?.columns ?? [],
                snapshot: () => ({
                  rows: [{ rowId: 'one', cells: { name: 'First task' } }],
                  retained: [],
                  version: table()?.version,
                }),
                loading: () => false,
                refreshing: () => false,
                error: () => undefined,
                refresh: () => okAsync(undefined),
                addOption: () => okAsync(undefined),
                retain: () => {},
                write: () => okAsync({ insertedRowIds: [], version: 1 }),
              },
            }}
          >
            <DatabaseRecords view={view} stored={false} />
          </DatabaseProvider>
        )}
      </Show>
    </main>
  );
}
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback="Loading schema…">
        <RenameFixture />
      </Suspense>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
