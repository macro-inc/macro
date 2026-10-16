import { Popover } from '@kobalte/core/popover';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';

/** Add a writable property to the task composer without assigning a value yet. */
export function TaskComposerPropertyPicker(props: {
  definitions: PropertyDefinition[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const matches = () =>
    props.definitions.filter((definition) =>
      definition.display_name
        .toLowerCase()
        .includes(query().trim().toLowerCase())
    );

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      placement="bottom-start"
      gutter={4}
    >
      <Popover.Trigger
        as={Button}
        size="sm"
        variant="ghost"
        aria-label="Add property"
      >
        <PlusIcon class="size-3.5" />
        Add property
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="menu-surface z-action-menu w-64 p-2 outline-none">
          <Popover.Title class="sr-only">Add property</Popover.Title>
          <div class="flex items-center gap-2 border-b border-edge-muted px-2 pb-2">
            <SearchIcon class="size-3.5 text-ink-muted" />
            <input
              type="search"
              aria-label="Search properties"
              placeholder="Search properties..."
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
            />
          </div>
          <div class="max-h-60 overflow-y-auto pt-1">
            <For each={matches()}>
              {(definition) => (
                <button
                  type="button"
                  class="flex w-full rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-hover focus-visible:bg-hover"
                  onClick={() => {
                    props.onAdd(definition.id);
                    setOpen(false);
                  }}
                >
                  {definition.display_name}
                </button>
              )}
            </For>
            <Show when={!matches().length}>
              <p class="px-2 py-1.5 text-sm text-ink-muted">
                No properties found
              </p>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
