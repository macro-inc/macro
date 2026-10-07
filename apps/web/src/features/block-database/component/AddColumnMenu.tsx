import PlusIcon from '@phosphor/plus.svg';
import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import { Button } from '@ui/components/Button';
import { createSignal, Show } from 'solid-js';
import { columnSchemaMessage } from '../../database/core/column-schema';
import { defaultDatabaseColumnName } from '../../database/core/property-creation';
import { createDatabaseColumn } from '../queries/columns';

/**
 * Add a Text column with the next free default name at the table's end; its
 * type is inferred from what is typed. Returns the new column's id.
 */
export function createDefaultColumn(args: {
  databaseId: string;
  tableId: string;
  columns: ColumnDetail[];
}) {
  const name = defaultDatabaseColumnName(
    args.columns.map(
      (entry) =>
        entry.column.display_name ?? entry.definition.definition.display_name
    )
  );
  return createDatabaseColumn({
    databaseId: args.databaseId,
    tableId: args.tableId,
    name,
    type: { type: 'text' },
    inferType: true,
  });
}

/** A new column starts as Text; name and type are edited in its header. */
export function AddColumnMenu(props: {
  databaseId: string;
  tableId: string;
  columns: ColumnDetail[];
  label?: string;
  onCreated?: (columnId: string) => boolean;
}) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  async function add() {
    if (pending()) return;
    setPending(true);
    setError('');
    const created = await createDefaultColumn(props);
    setPending(false);
    created.match(
      (id) => props.onCreated?.(id),
      (error) => setError(columnSchemaMessage(error))
    );
  }
  return (
    <div class="relative">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending()}
        aria-label={props.label ?? 'Add column'}
        onClick={() => void add()}
      >
        <PlusIcon class="size-3.5" />
        {props.label ?? 'Add column'}
      </Button>
      <Show when={error()}>
        <span
          role="alert"
          class="absolute top-full right-0 z-2 w-52 rounded-md border border-edge-muted bg-panel p-2 text-xs text-failure-ink shadow-md"
        >
          {error()}
        </span>
      </Show>
    </div>
  );
}
