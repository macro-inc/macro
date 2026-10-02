import { Entity, type EntityData } from '@entity';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import { debounce } from '@solid-primitives/scheduled';
import {
  ActionDialogShell,
  Button,
  CommandMenuList,
  CommandMenuSearchInput,
  createCommandListController,
} from '@ui';
import {
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useReminderPickerItems } from '../queries/use-reminder-picker-items';

/** A local Command-K-style selection; it never changes the global command menu. */
export function ReminderEntityPicker(props: {
  onSelect: (entity: EntityData) => void;
  onWrite: () => void;
}) {
  const [search, setSearch] = createSignal('');
  const [settledSearch, setSettledSearch] = createSignal('');
  const settle = debounce(setSettledSearch, 150);
  onCleanup(settle.clear);
  const results = useReminderPickerItems(search, settledSearch);
  const items = results.items;
  const controller = createCommandListController({
    items,
    onSelect: (item) => props.onSelect(item.data),
  });
  const listId = createUniqueId();
  let input: HTMLInputElement | undefined;
  // This picker can replace a schedule form inside the already-open dialog.
  onMount(() => input?.focus());
  return (
    <>
      <ActionDialogShell.Body>
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>Remind me about…</ActionDialogShell.Title>
          <ActionDialogShell.Description>
            Pick something to come back to.
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>
        <div class="flex items-center gap-2 border-b border-edge-muted pb-3">
          <MagnifyingGlass class="size-4 shrink-0 text-ink-muted" />
          <CommandMenuSearchInput
            ref={input}
            value={search()}
            placeholder="Search emails, tasks, docs…"
            aria-label="Search reminder items"
            role="combobox"
            autocomplete="off"
            aria-expanded={true}
            aria-controls={listId}
            aria-activedescendant={
              items().length
                ? `${listId}-${controller.selectedIndex()}`
                : undefined
            }
            onInput={(event) => {
              setSearch(event.currentTarget.value);
              settle(event.currentTarget.value);
              controller.setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.isComposing) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                controller.selectNext();
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                controller.selectPrevious();
              } else if (event.key === 'Enter') {
                event.preventDefault();
                controller.selectSelected();
              }
            }}
          />
        </div>
        <div class="min-h-32">
          <p class="text-xs text-ink-muted">
            {search().trim() ? 'Matching items' : 'Recent items'}
          </p>
          <CommandMenuList
            id={listId}
            items={items()}
            selectedIndex={controller.selectedIndex()}
            itemId={(_, index) => `${listId}-${index}`}
            scrollSelectedIntoView={controller.shouldScrollSelectedIntoView()}
            onItemMouseMove={controller.setSelectedIndexFromPointer}
            onSelect={(item) => props.onSelect(item.data)}
            class="max-h-64 -mx-2.5"
          >
            {(item) => (
              <>
                <span class="size-5 shrink-0">
                  <Entity.Icon entity={item.data} />
                </span>
                <span class="min-w-0 flex-1 truncate">
                  <Entity.Title entity={item.data} />
                </span>
              </>
            )}
          </CommandMenuList>
          <Show when={!items().length}>
            <p role="status" class="py-6 text-center text-sm text-ink-muted">
              {results.isLoading() ? 'Loading items…' : 'No matching items'}
            </p>
          </Show>
          <Show when={results.hasMore()}>
            <Button
              variant="ghost"
              onClick={() => void results.loadMore()}
              disabled={results.isLoadingMore()}
            >
              Load more
            </Button>
          </Show>
        </div>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Button
          variant="ghost"
          class="w-full justify-start gap-2"
          onClick={props.onWrite}
        >
          <PencilSimple class="size-4" /> Write a reminder instead
        </Button>
      </ActionDialogShell.Footer>
    </>
  );
}
