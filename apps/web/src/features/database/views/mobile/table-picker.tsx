import { triggerFocusNewElement } from '@core/directive/focusInput';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TableIcon from '@icon/system/regular/table.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { CreateTable } from '../../core/table-creation';
import { NEW_TABLE_NAME_ATTRIBUTE, NewTableDialog } from './new-table-dialog';

/**
 * A phone's table switcher: the open table's name, with every table in a
 * menu. A phone's split header has no room for a tab per table.
 */
export function TablePicker(props: {
  tables: { id: string; name: string }[];
  activeTableId: string | undefined;
  /** Creates a table the viewer named; omitted when they cannot. */
  onCreate?: CreateTable;
  /** The host's own items after the tables, e.g. the open table's forms. */
  menuItems?: () => JSX.Element;
  onSelect: (tableId: string) => void;
}) {
  const [creating, setCreating] = createSignal(false);
  /** A host may draw this menu again for the table it switched to. */
  let switchedTable = false;
  /** The dialog opens once the menu has closed: a menu closing over an open dialog leaves the page inert. */
  let createOnMenuClose = false;
  const activeName = () =>
    props.tables.find((table) => table.id === props.activeTableId)?.name;

  return (
    <>
      <Dropdown placement="bottom-start">
        <Dropdown.Trigger
          data-table-picker
          aria-label={activeName() ? `Table: ${activeName()}` : 'Tables'}
          variant="secondary"
          size="md"
          class="min-w-0 max-w-full"
        >
          <TableIcon class="size-3.5 shrink-0" />
          <span class="truncate">{activeName() ?? 'Tables'}</span>
          <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
        </Dropdown.Trigger>
        <Dropdown.Content
          class="min-w-56 max-w-[calc(100vw-2rem)]"
          onCloseAutoFocus={(event) => {
            if (createOnMenuClose) {
              createOnMenuClose = false;
              setCreating(true);
              return;
            }

            if (!switchedTable) return;
            switchedTable = false;

            // The button this menu opened from may be gone with the table it
            // named: focus the one on the page now.
            event.preventDefault();
            queueMicrotask(() =>
              document
                .querySelector<HTMLElement>('[data-table-picker]')
                ?.focus()
            );
          }}
        >
          <Dropdown.Group>
            <Dropdown.GroupLabel>Tables</Dropdown.GroupLabel>
            <Dropdown.RadioGroup
              value={props.activeTableId}
              onChange={(tableId) => {
                switchedTable = tableId !== props.activeTableId;
                props.onSelect(tableId);
              }}
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
          <Show when={props.onCreate || props.menuItems}>
            <Dropdown.Separator class="my-1 border-t border-edge-divider" />
            <Dropdown.Group>
              <Show when={props.onCreate}>
                <Dropdown.Item
                  onSelect={() => {
                    // iOS raises the keyboard only for a focus inside the tap.
                    triggerFocusNewElement(`[${NEW_TABLE_NAME_ATTRIBUTE}]`, {
                      touchOnly: true,
                    });
                    createOnMenuClose = true;
                  }}
                >
                  <PlusIcon class="size-4" />
                  New table
                </Dropdown.Item>
              </Show>
              {props.menuItems?.()}
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
      <Show when={creating() && props.onCreate}>
        {(onCreate) => (
          <NewTableDialog
            existingNames={props.tables.map((table) => table.name)}
            onCreate={onCreate()}
            onOpenTable={props.onSelect}
            onOpenChange={setCreating}
          />
        )}
      </Show>
    </>
  );
}
