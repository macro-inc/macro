import {
  CommandMenuEmptyState,
  CommandMenuList,
  CommandMenuSearchInput,
  CommandMenuShell,
  createCommandListController,
  Dialog,
  type ManagedDialogProps,
} from '@ui';
import { createUniqueId, Show } from 'solid-js';
import { formatSnoozeDeadline, type SnoozeOption } from '../core/snooze';

export function SnoozePicker(
  props: ManagedDialogProps & {
    count: number;
    query: string;
    onQueryChange: (query: string) => void;
    options: SnoozeOption[];
    pending: boolean;
    error?: string;
    onSelect: (until: Date) => void;
  }
) {
  const id = createUniqueId();
  const select = (option: SnoozeOption) => {
    if (!props.pending) props.onSelect(option.until);
  };
  const list = createCommandListController({
    items: () => props.options,
    onSelect: select,
  });
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} visibleScrim>
      <CommandMenuShell>
        <CommandMenuShell.Header>
          <CommandMenuSearchInput
            aria-label="Snooze until"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-options`}
            aria-activedescendant={
              props.options.length ? `${id}-${list.selectedIndex()}` : undefined
            }
            placeholder="Choose a time, or type tomorrow 10am…"
            value={props.query}
            disabled={props.pending}
            onInput={(event) => {
              props.onQueryChange(event.currentTarget.value);
              list.setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                list.selectNext();
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                list.selectPrevious();
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                list.selectSelected();
              }
            }}
          />
        </CommandMenuShell.Header>
        <CommandMenuShell.Toolbar class="flex-col items-start gap-1 px-4 py-3">
          <Dialog.Title class="text-sm font-medium text-ink">
            Snooze notifications
            {props.count > 1 ? ` for ${props.count} items` : ''}
          </Dialog.Title>
          <Dialog.Description class="text-xs text-ink-muted">
            Notifications resume automatically. Times are in your local time
            zone.
          </Dialog.Description>
        </CommandMenuShell.Toolbar>
        <CommandMenuShell.Body class="flex flex-col">
          <CommandMenuList
            id={`${id}-options`}
            items={props.options}
            selectedIndex={list.selectedIndex()}
            scrollSelectedIntoView={list.shouldScrollSelectedIntoView()}
            itemId={(_, index) => `${id}-${index}`}
            itemDisabled={() => props.pending}
            onItemMouseMove={list.setSelectedIndexFromPointer}
            onSelect={select}
            class="min-h-0 max-h-80 mobile:[&_[role=option]]:h-auto mobile:[&_[role=option]]:min-h-12 mobile:[&_[role=option]]:py-2"
          >
            {(option) => (
              <div class="flex min-w-0 flex-1 items-center gap-2 mobile:flex-col mobile:items-start mobile:gap-0.5">
                <span class="flex-1 font-medium mobile:flex-none">
                  {option.label}
                </span>
                <span class="text-xs font-normal text-ink-muted">
                  {formatSnoozeDeadline(option.until)}
                </span>
              </div>
            )}
          </CommandMenuList>
          <Show when={!props.options.length}>
            <CommandMenuEmptyState>
              Enter a future time, like 2h or tomorrow 10am.
            </CommandMenuEmptyState>
          </Show>
          <Show when={props.error}>
            <p role="alert" class="px-4 pb-3 text-sm text-failure-ink">
              {props.error}
            </p>
          </Show>
        </CommandMenuShell.Body>
        <CommandMenuShell.Footer>
          <span role="status">
            <Show when={!props.pending} fallback="Snoozing…">
              <span class="mobile:hidden">
                ↑ ↓ to choose · Enter to snooze · Esc to cancel
              </span>
              <span class="hidden mobile:inline">Tap a time to snooze</span>
            </Show>
          </span>
          <button
            type="button"
            class="ml-auto shrink-0 text-ink-muted hover:text-ink mobile:min-h-11 mobile:px-2"
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </button>
        </CommandMenuShell.Footer>
      </CommandMenuShell>
    </Dialog>
  );
}
