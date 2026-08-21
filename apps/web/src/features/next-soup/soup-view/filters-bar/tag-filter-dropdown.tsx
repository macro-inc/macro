import TagIcon from '@phosphor/tag.svg';
import { cn, Dropdown, Tooltip } from '@ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { SearchableMultiSelectInline } from './searchable-multi-select';
import { useTagFilter } from './tag-filter';

/** Compact tag-only filter used by focused list layouts. */
export function TagFilterDropdown() {
  const tagFilter = useTagFilter();
  const [open, setOpen] = createSignal(false);
  const [input, setInput] = createSignal<HTMLInputElement>();

  createEffect(() => {
    const element = input();
    if (!open() || !element) return;
    const frame = requestAnimationFrame(() => element.focus());
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <Dropdown open={open()} onOpenChange={setOpen} placement="bottom-end">
      <Tooltip label="Filter by tags">
        <Dropdown.Trigger
          depth={2}
          class="relative !size-10 rounded-full bg-surface px-0"
          aria-label="Filter by tags"
          disabled={!tagFilter.hasTags()}
        >
          <TagIcon class="size-4" />
          <Show when={tagFilter.activeIds().length > 0}>
            <span
              class={cn(
                'absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full',
                'bg-accent text-[9px] font-semibold leading-none text-surface'
              )}
            >
              {tagFilter.activeIds().length}
            </span>
          </Show>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content class="w-65 max-w-[90vw] p-0">
        <Dropdown.Group class="gap-0 p-0">
          <SearchableMultiSelectInline
            onRequestClose={() => setOpen(false)}
            placeholder="Filter by tag..."
            activeIds={tagFilter.activeIds}
            onChange={tagFilter.onChange}
            options={tagFilter.options}
            inputRef={setInput}
          />
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
