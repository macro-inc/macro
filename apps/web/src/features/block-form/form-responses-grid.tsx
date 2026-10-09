/**
 * App adapter: the Responses tab's grid is the linked table's own grid
 * (`DatabaseGrid`), fed from the database's queries and kept live by its
 * gateway sync. Form editors hold edit on the database through the derived
 * access rule, so the grid edits as it does on the database page.
 */
import { DatabaseGrid } from '@block-database/component/DatabaseGrid';
import { useDatabaseDetailQuery } from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { createSignal, Show } from 'solid-js';
import type { DatabaseRelatedDestination } from '../database/core/database-relations';
import { allRecordsView } from '../database/core/views';

export function FormResponsesGrid(props: {
  databaseId: string;
  tableId: string;
  onOpenRelated: (destination: DatabaseRelatedDestination) => void;
}) {
  useDatabaseTableChangedSync(() => props.databaseId);
  const detail = useDatabaseDetailQuery(() => props.databaseId);
  const table = () =>
    detail.isSuccess
      ? detail.data.tables.find((entry) => entry.table.id === props.tableId)
      : undefined;
  const canEdit = () =>
    detail.isSuccess &&
    (detail.data.grant === 'edit' || detail.data.grant === 'owner');
  /** The viewer's own filter, sort and layout of All records, for this visit. */
  const [changed, setChanged] = createSignal<DatabaseView>();
  return (
    <Show
      when={!detail.isPending}
      fallback={
        <div class="p-6 text-xs text-ink-muted" aria-busy="true">
          Loading responses…
        </div>
      }
    >
      <Show
        when={table()}
        fallback={
          <div
            role="alert"
            class="grid flex-1 place-items-center p-6 text-sm text-ink-muted"
          >
            {detail.isError
              ? 'The responses couldn’t be loaded. You may no longer have access to the database.'
              : 'This form’s table no longer exists.'}
          </div>
        }
      >
        {(shown) => {
          const view = () => {
            const own = changed();
            return own?.tableId === shown().table.id
              ? own
              : allRecordsView(shown().table);
          };
          return (
            <div class="@container/database flex min-h-0 flex-1 flex-col overflow-hidden">
              <DatabaseGrid
                databaseId={props.databaseId}
                table={shown()}
                canEdit={canEdit()}
                view={view()}
                stored={false}
                onViewChange={(change) => setChanged({ ...view(), ...change })}
                onClearConstraints={() =>
                  setChanged({
                    ...view(),
                    query: { ...view().query, filter: null },
                  })
                }
                onOpenRelated={props.onOpenRelated}
              />
            </div>
          );
        }}
      </Show>
    </Show>
  );
}
