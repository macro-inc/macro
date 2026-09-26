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

export type SnoozeEntityOption = { id: string; name: string; type: string };

export function SnoozeEntityPicker(
  props: ManagedDialogProps & {
    query: string;
    onQueryChange: (query: string) => void;
    items: SnoozeEntityOption[];
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onSelect: (item: SnoozeEntityOption) => void;
  }
) {
  const id = createUniqueId();
  const list = createCommandListController({
    items: () => props.items,
    onSelect: props.onSelect,
  });
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      class="w-120 max-w-[calc(100vw-24px)]"
      visibleScrim
    >
      <CommandMenuShell>
        <CommandMenuShell.Header>
          <CommandMenuSearchInput
            aria-label="Find an item to snooze"
            placeholder="Search for an item…"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-items`}
            aria-activedescendant={
              props.items.length ? `${id}-${list.selectedIndex()}` : undefined
            }
            value={props.query}
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
            Snooze an item
          </Dialog.Title>
          <Dialog.Description class="text-xs text-ink-muted">
            Choose an item, then choose when notifications resume.
          </Dialog.Description>
        </CommandMenuShell.Toolbar>
        <CommandMenuShell.Body>
          <CommandMenuList
            id={`${id}-items`}
            items={props.items}
            selectedIndex={list.selectedIndex()}
            scrollSelectedIntoView={list.shouldScrollSelectedIntoView()}
            itemId={(_, index) => `${id}-${index}`}
            onItemMouseMove={list.setSelectedIndexFromPointer}
            onSelect={props.onSelect}
            class="max-h-80"
          >
            {(item) => (
              <>
                <span class="min-w-0 flex-1 truncate" title={item.name}>
                  {item.name}
                </span>
                <span class="text-xs font-normal text-ink-muted">
                  {item.type}
                </span>
              </>
            )}
          </CommandMenuList>
          <Show when={!props.items.length}>
            <CommandMenuEmptyState>
              {props.loading ? 'Loading items…' : 'No matching items'}
            </CommandMenuEmptyState>
          </Show>
          <Show when={props.hasMore}>
            <button
              type="button"
              class="px-4 py-2 text-sm text-ink-muted"
              disabled={props.loading}
              onClick={props.onLoadMore}
            >
              Load more
            </button>
          </Show>
        </CommandMenuShell.Body>
        <CommandMenuShell.Footer>
          <span>↑ ↓ to choose · Enter to continue</span>
          <button
            type="button"
            class="ml-auto text-ink-muted hover:text-ink"
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </button>
        </CommandMenuShell.Footer>
      </CommandMenuShell>
    </Dialog>
  );
}
