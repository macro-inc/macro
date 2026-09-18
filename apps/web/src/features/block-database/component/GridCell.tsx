import CaretDownIcon from '@phosphor/caret-down.svg';
import { Property } from '@property';
import type { PropertyApiValues, Property as PropertyT } from '@property/types';
import type {
  DatabaseColumnDetail,
  SqlValue,
} from '@service-storage/databases';
import { cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import {
  apiValuesToSqlValue,
  cellToProperty,
  displayCellValue,
  isSelectColumn,
  optionLabel,
} from '../cell';

type GridCellProps = {
  column: DatabaseColumnDetail;
  rowId: string;
  value: SqlValue;
  canEdit: boolean;
  onWrite: (value: SqlValue) => void;
};

/**
 * One grid cell.
 *
 * Text, number, boolean, link and date columns edit through the shared
 * `@property` editors. Select columns use the dropdown below, because SQL
 * carries the option's display label while the property editors carry option
 * ids — the schema response already ships the labels, so no second fetch.
 * Entity, tag and multi-valued columns render read-only for now.
 */
export function GridCell(props: GridCellProps) {
  const property = (): PropertyT | undefined =>
    props.canEdit
      ? cellToProperty(props.column, props.rowId, props.value)
      : undefined;

  const save = async (_property: PropertyT, values: PropertyApiValues) => {
    props.onWrite(apiValuesToSqlValue(values));
  };

  return (
    <Show
      when={property()}
      fallback={
        <Show
          when={props.canEdit && isSelectColumn(props.column)}
          fallback={
            <div class="truncate px-2 py-1 text-ink-muted text-xs">
              {displayCellValue(props.column, props.value)}
            </div>
          }
        >
          <SelectCell
            column={props.column}
            value={props.value}
            onWrite={props.onWrite}
          />
        </Show>
      }
    >
      {(cellProperty) => (
        <Property.Root
          property={cellProperty()}
          canEdit={props.canEdit}
          onSave={save}
          class="min-w-0 text-xs"
        >
          <Property.Display />
        </Property.Root>
      )}
    </Show>
  );
}

function SelectCell(props: {
  column: DatabaseColumnDetail;
  value: SqlValue;
  onWrite: (value: SqlValue) => void;
}) {
  const options = () => props.column.definition.property_options;
  const label = () => (props.value === null ? '' : String(props.value));

  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        class="w-full justify-between px-2 text-xs"
      >
        <span class={cn('truncate', !label() && 'text-ink-extra-muted')}>
          {label() || 'Empty'}
        </span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Item onSelect={() => props.onWrite(null)}>
          Empty
        </Dropdown.Item>
        <For each={options()}>
          {(option) => (
            <Dropdown.Item onSelect={() => props.onWrite(optionLabel(option))}>
              {optionLabel(option)}
            </Dropdown.Item>
          )}
        </For>
      </Dropdown.Content>
    </Dropdown>
  );
}
