import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import { invalidateDatabase } from '@queries/storage/databases';
import { storageServiceClient } from '@service-storage/client';
import type { DatabaseTableDetail } from '@service-storage/databases';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';

type TableTabsProps = {
  databaseId: string;
  tables: DatabaseTableDetail[];
  activeTableId: string | undefined;
  canEdit: boolean;
  onSelect: (tableId: string) => void;
};

/**
 * Tabs are tables. The only place the "a database is a collection" concept
 * surfaces — the rest of the UI says "table".
 */
export function TableTabs(props: TableTabsProps) {
  const [creating, setCreating] = createSignal(false);

  const addTable = async () => {
    if (creating()) return;
    setCreating(true);
    const result = await storageServiceClient.databases.createTable({
      id: props.databaseId,
      name: `Table ${props.tables.length + 1}`,
    });
    setCreating(false);
    if (result.isErr()) {
      toast.failure('Could not add a tab');
      return;
    }
    await invalidateDatabase(props.databaseId);
    props.onSelect(result.value.id);
  };

  return (
    <div class="flex shrink-0 items-center gap-1 border-edge border-b px-2">
      <For each={props.tables}>
        {(table) => (
          <button
            type="button"
            class={cn(
              '-mb-px border-b-2 px-2.5 py-1.5 text-xs',
              table.table.id === props.activeTableId
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}
            onClick={() => props.onSelect(table.table.id)}
          >
            {table.table.name}
          </button>
        )}
      </For>
      <Show when={props.canEdit}>
        <button
          type="button"
          class="rounded-sm p-1 text-ink-extra-muted hover:bg-hover hover:text-ink"
          title="Add tab"
          onClick={addTable}
        >
          <PlusIcon class="size-3" />
        </button>
      </Show>
    </div>
  );
}
