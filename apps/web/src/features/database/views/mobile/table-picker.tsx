import { triggerFocusNewElement } from '@core/directive/focusInput';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TableIcon from '@icon/system/regular/table.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
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
  /** Switches tables. A host may then draw this menu again for the new table. */
  onSelect: (tableId: string) => void;
  /**
   * Whether this menu's button takes focus as it appears: a host sets it
   * for the menu it draws after `onSelect`, whose own button is gone.
   */
  takeFocus?: boolean;
  onFocusTaken?: () => void;
}) {
  const [creating, setCreating] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  // What the menu and the dialog start happens once they have closed: one
  // closing over an open dialog leaves the page inert, and a switch draws
  // this menu again, which an open one would take focus back from.
  let createOnMenuClose = false;
  let switchOnMenuClose: string | undefined;
  let switchOnDialogClose: string | undefined;
  const activeName = () =>
    props.tables.find((table) => table.id === props.activeTableId)?.name;

  onMount(() => {
    if (!props.takeFocus) return;

    trigger?.focus();
    props.onFocusTaken?.();
  });

  return (
    <>
      <Dropdown placement="bottom-start">
        <Dropdown.Trigger
          ref={(element: HTMLButtonElement) => {
            trigger = element;
          }}
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

            const tableId = switchOnMenuClose;
            switchOnMenuClose = undefined;
            if (!tableId) return;

            // The host places focus on the menu it draws for the table.
            event.preventDefault();
            props.onSelect(tableId);
          }}
        >
          <Dropdown.Group>
            <Dropdown.GroupLabel>Tables</Dropdown.GroupLabel>
            <Dropdown.RadioGroup
              value={props.activeTableId}
              onChange={(tableId) => {
                switchOnMenuClose = tableId;
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
            onOpenTable={(tableId) => {
              switchOnDialogClose = tableId;
            }}
            onOpenChange={setCreating}
            onCloseAutoFocus={(event) => {
              event.preventDefault();

              const tableId = switchOnDialogClose;
              switchOnDialogClose = undefined;
              if (tableId) props.onSelect(tableId);
              // The dialog opened from a menu item that is gone.
              else trigger?.focus();
            }}
          />
        )}
      </Show>
    </>
  );
}
