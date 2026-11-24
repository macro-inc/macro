import { triggerFocusNewElement } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui/components/Button';
import { createSignal, Show } from 'solid-js';
import type { CreateTable } from '../../core/table-creation';
import { NEW_TABLE_NAME_ATTRIBUTE, NewTableDialog } from './new-table-dialog';

/**
 * What a database without tables shows on touch devices. A phone has no
 * table tabs in its header to add one from, so it offers the table here.
 */
export function MobileNoTables(props: {
  /** Creates a table the viewer named; omitted when they cannot. */
  onCreate?: CreateTable;
  onOpenTable: (tableId: string) => void;
}) {
  const [creating, setCreating] = createSignal(false);
  let newTable: HTMLButtonElement | undefined;

  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-ink-muted">
      <p>Add a table to start organizing your data.</p>
      <Show when={isMobile() && props.onCreate}>
        {(onCreate) => (
          <>
            <Button
              ref={newTable}
              variant="secondary"
              size="md"
              onClick={() => {
                // iOS raises the keyboard only for a focus inside the tap.
                triggerFocusNewElement(`[${NEW_TABLE_NAME_ATTRIBUTE}]`, {
                  touchOnly: true,
                });
                setCreating(true);
              }}
            >
              <PlusIcon class="size-3.5" />
              New table
            </Button>
            <Show when={creating()}>
              <NewTableDialog
                existingNames={[]}
                onCreate={onCreate()}
                onOpenTable={props.onOpenTable}
                onOpenChange={setCreating}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  newTable?.focus();
                }}
              />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
