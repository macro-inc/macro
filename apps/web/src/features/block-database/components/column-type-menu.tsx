import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { type Accessor, createSignal, For, type JSX, Show } from 'solid-js';
import {
  castFor,
  castTargetOf,
  type DatabaseColumnCast,
  type DatabaseColumnCasts,
  type DatabaseColumnConversion,
  type DatabaseColumnKind,
  type DatabaseColumnTypeChange,
} from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import { PropertyIcon } from './property-icon';

const types: { label: string; to: DatabaseColumnKind }[] = [
  { label: 'Text', to: { type: 'text' } },
  { label: 'Number', to: { type: 'number' } },
  { label: 'Select', to: { type: 'select', multi: false } },
  { label: 'Multi-select', to: { type: 'select', multi: true } },
  { label: 'Date', to: { type: 'date' } },
  { label: 'Checkbox', to: { type: 'boolean' } },
  { label: 'URL', to: { type: 'link' } },
  { label: 'People', to: { type: 'entity', target: 'USER', multi: false } },
  {
    label: 'Documents',
    to: { type: 'entity', target: 'DOCUMENT', multi: false },
  },
  { label: 'Tasks', to: { type: 'entity', target: 'TASK', multi: false } },
];

/** A checked type some values do not fit, offered as a new column beside this one. */
export type DatabaseColumnConversionChoice = Omit<
  DatabaseColumnConversion,
  'columnName'
> & {
  cast: Extract<DatabaseColumnCast, { verdict: 'checked' }>;
};

export function ColumnTypeMenu(props: {
  column: DatabaseViewColumn;
  tables?: { id: string; name: string }[];
  /** The dry run, read while the submenu is open. */
  loadCasts?: (
    open: Accessor<boolean>
  ) => Accessor<DatabaseColumnCasts> | undefined;
  onChange: (change: DatabaseColumnTypeChange) => void;
  /**
   * A type some values do not fit is never changed in place; without this
   * it is not offered.
   */
  onConvertToNewColumn?: (choice: DatabaseColumnConversionChoice) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const casts = props.loadCasts?.(open);
  const castOf = (to: DatabaseColumnKind) =>
    casts ? castFor(casts(), to) : undefined;
  const selected = (to: DatabaseColumnKind) => {
    const target = castTargetOf(to);
    return (
      !props.column.relation &&
      props.column.dataType === target.dataType &&
      props.column.isMultiSelect === target.isMultiSelect &&
      (props.column.specificEntityType ?? undefined) ===
        target.specificEntityType
    );
  };
  /** A type no value converts to is left out; until the dry run answers, nothing is listed. */
  const offered = (to: DatabaseColumnKind) => {
    const cast = castOf(to);
    if (cast?.verdict === 'never') return false;
    return !misfits(cast) || !!props.onConvertToNewColumn;
  };
  const checking = () => casts?.().status === 'loading';
  const offeredTables = () =>
    (props.tables ?? []).filter((table) =>
      offered({ type: 'relation', table: table.id })
    );
  const choose = (label: string, to: DatabaseColumnKind) => {
    const cast = castOf(to);
    if (misfits(cast)) {
      props.onConvertToNewColumn?.({ to, label, cast });
      return;
    }
    const read = casts?.();
    props.onChange({
      to,
      baseVersion: read?.status === 'ready' ? read.version : undefined,
    });
  };
  return (
    <Dropdown.Sub open={open()} onOpenChange={setOpen}>
      <Dropdown.SubTrigger>
        <PropertyIcon
          type={props.column.dataType}
          entityType={props.column.specificEntityType}
          relation={!!props.column.relation}
        />
        <span class="flex-1">Change type</span>
        <CaretRightIcon class="size-3" />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent class="w-60 max-h-[min(28rem,80vh)] overflow-y-auto">
        <Show when={checking()}>
          <Dropdown.Item disabled>
            <span class="text-xs text-ink-muted">Checking values…</span>
          </Dropdown.Item>
        </Show>
        <Show when={!checking()}>
          <Dropdown.Group>
            <For each={types.filter((type) => offered(type.to))}>
              {(type) => (
                <TypeItem
                  label={type.label}
                  cast={castOf(type.to)}
                  icon={
                    <PropertyIcon
                      type={castTargetOf(type.to).dataType}
                      entityType={castTargetOf(type.to).specificEntityType}
                    />
                  }
                  selected={selected(type.to)}
                  onSelect={() => choose(type.label, type.to)}
                />
              )}
            </For>
          </Dropdown.Group>
          <Show when={offeredTables().length}>
            <Dropdown.Group>
              <Dropdown.GroupLabel>Related table</Dropdown.GroupLabel>
              <For each={offeredTables()}>
                {(table) => {
                  const to: DatabaseColumnKind = {
                    type: 'relation',
                    table: table.id,
                  };
                  return (
                    <TypeItem
                      label={table.name}
                      cast={castOf(to)}
                      icon={<PropertyIcon type="ENTITY" relation />}
                      selected={props.column.relation?.tableId === table.id}
                      onSelect={() => choose(table.name, to)}
                    />
                  );
                }}
              </For>
            </Dropdown.Group>
          </Show>
        </Show>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}

/** A checked type some values do not fit. */
function misfits(
  cast: DatabaseColumnCast | undefined
): cast is Extract<DatabaseColumnCast, { verdict: 'checked' }> {
  return cast?.verdict === 'checked' && cast.failures > 0;
}

/** One offered type; a checked one says which values do not fit. */
function TypeItem(props: {
  label: string;
  cast: DatabaseColumnCast | undefined;
  icon: JSX.Element;
  selected: boolean;
  onSelect: () => void;
}) {
  const description = () => {
    const cast = props.cast;
    if (!misfits(cast)) return undefined;
    return [cast.summary, 'Converts into a new column']
      .filter((part) => !!part)
      .join(' · ');
  };
  return (
    <Dropdown.Item onSelect={props.onSelect}>
      {props.icon}
      <span class="flex min-w-0 flex-1 flex-col">
        <Dropdown.ItemLabel class="truncate">{props.label}</Dropdown.ItemLabel>
        <Show when={description()}>
          {(text) => (
            <Dropdown.ItemDescription class="text-xs text-ink-muted">
              {text()}
            </Dropdown.ItemDescription>
          )}
        </Show>
      </span>
      <Show when={props.selected}>
        <CheckIcon class="size-3.5" />
      </Show>
    </Dropdown.Item>
  );
}
