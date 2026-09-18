import { toast } from '@core/component/Toast/Toast';
import { Tabs } from '@kobalte/core/tabs';
import PlusIcon from '@phosphor/plus.svg';
import { createDatabaseTable } from '@queries/storage/databases';
import type { DatabaseTableDetail } from '@service-storage/databases';
import { Tooltip } from '@ui';
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
 *
 * Kobalte drives the tab list so roles, `aria-selected` and arrow-key movement
 * come for free; the panels live outside, because a tab switch swaps the whole
 * grid rather than a slot inside the list.
 */
export function TableTabs(props: TableTabsProps) {
  const [creating, setCreating] = createSignal(false);

  const addTable = async () => {
    if (creating()) return;
    setCreating(true);
    const tableId = await createDatabaseTable({
      databaseId: props.databaseId,
      name: `Table ${props.tables.length + 1}`,
    });
    setCreating(false);
    if (!tableId) {
      toast.failure('Could not add a tab');
      return;
    }
    props.onSelect(tableId);
  };

  return (
    <div class="flex shrink-0 items-center gap-1 border-edge border-b px-2">
      <Tabs
        value={props.activeTableId ?? ''}
        onChange={props.onSelect}
        class="min-w-0 flex-1"
      >
        <Tabs.List class="flex items-center gap-1 overflow-x-auto">
          <For each={props.tables}>
            {(table) => (
              <Tabs.Trigger
                value={table.table.id}
                class="-mb-px shrink-0 border-transparent border-b-2 px-2.5 py-1.5 text-ink-muted text-xs outline-none hover:text-ink data-selected:border-accent data-selected:text-ink"
              >
                {table.table.name}
              </Tabs.Trigger>
            )}
          </For>
        </Tabs.List>
      </Tabs>
      <Show when={props.canEdit}>
        <Tooltip label="Add tab">
          <button
            type="button"
            class="rounded-sm p-1 text-ink-extra-muted hover:bg-hover hover:text-ink"
            aria-label="Add tab"
            onClick={addTable}
          >
            <PlusIcon class="size-3" />
          </button>
        </Tooltip>
      </Show>
    </div>
  );
}
