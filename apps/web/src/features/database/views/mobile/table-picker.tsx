import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import TableIcon from '@icon/system/regular/table.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { For, type JSX, Show } from 'solid-js';

/**
 * A phone's table switcher: the open table's name, with every table in a
 * menu. A phone's split header has no room for a tab per table.
 */
export function TablePicker(props: {
  tables: { id: string; name: string }[];
  activeTableId: string | undefined;
  /** The host's own items after the tables, e.g. the open table's forms. */
  menuItems?: () => JSX.Element;
  onSelect: (tableId: string) => void;
}) {
  const activeName = () =>
    props.tables.find((table) => table.id === props.activeTableId)?.name;

  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        aria-label={activeName() ? `Table: ${activeName()}` : 'Tables'}
        variant="secondary"
        size="md"
        class="min-w-0 max-w-full"
      >
        <TableIcon class="size-3.5 shrink-0" />
        <span class="truncate">{activeName() ?? 'Tables'}</span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-56 max-w-[calc(100vw-2rem)]">
        <Dropdown.Group>
          <Dropdown.GroupLabel>Tables</Dropdown.GroupLabel>
          <Dropdown.RadioGroup
            value={props.activeTableId}
            onChange={props.onSelect}
          >
            <For each={props.tables}>
              {(table) => (
                <Dropdown.RadioItem closeOnSelect value={table.id}>
                  <TableIcon class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{table.name}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
        <Show when={props.menuItems}>
          {(menuItems) => (
            <>
              <Dropdown.Separator class="my-1 border-t border-edge-divider" />
              <Dropdown.Group>{menuItems()()}</Dropdown.Group>
            </>
          )}
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
