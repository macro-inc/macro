import SearchIcon from '@phosphor/magnifying-glass.svg';
import {
  CommandMenuList,
  CommandMenuSearchInput,
  CommandMenuShell,
  cn,
  createCommandListController,
} from '@ui';
import { createMemo, createSignal, createUniqueId, Show } from 'solid-js';
import {
  type CreateMenuSection,
  createMenuSearchText,
  groupCreateMenuItems,
  groupRecentCreateMenuItems,
} from '../core/create-menu-details';
import { LauncherMenuItem, useRecentCreateMenuBlocks } from '../Launcher';
import type { CreatableBlock } from '../types';
import { CarouselCards } from './CarouselCards';
import { LauncherDetails } from './LauncherDetails';

/** Inline previews using Jacob's layout proportions and the existing static icons. */
export function CreateMenuPreview(props: {
  layout: 'list' | 'carousel' | 'details';
  detailsLeft?: boolean;
  items: CreatableBlock[];
  onChoose: (item: CreatableBlock) => void;
}) {
  const id = createUniqueId();
  const [query, setQuery] = createSignal('');
  let root!: HTMLDivElement;
  const recentItems = useRecentCreateMenuBlocks(() => props.items);
  const sections = createMemo<CreateMenuSection[]>(() => {
    const terms = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = props.items.filter((item) => {
      const text = [
        item.label,
        item.launcherHint,
        ...(item.keywords ?? []),
        ...createMenuSearchText(item),
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((term) => text.includes(term));
    });
    if (props.layout === 'details')
      return groupRecentCreateMenuItems(filtered, recentItems());
    if (props.layout === 'list' || query().trim())
      return [
        {
          group: { id: 'other', label: 'Results', tagline: '' },
          items: filtered,
        },
      ];
    return groupCreateMenuItems(filtered);
  });
  const items = createMemo(() =>
    sections().flatMap((section) => section.items)
  );
  const c = createCommandListController({ items, onSelect: props.onChoose });
  const selected = c.selectedItem;
  const itemId = (item: CreatableBlock) =>
    `${id}-${item.label.replaceAll(' ', '-')}`;
  const changeQuery = (value: string) => {
    setQuery(value);
    c.setSelectedIndex(0);
  };
  const step = (direction: number) => {
    const count = items().length;
    if (count)
      c.setSelectedIndex(
        (((c.selectedIndex() + direction) % count) + count) % count
      );
  };

  function onKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey)
      return;
    const input = event.target instanceof HTMLInputElement;
    const next =
      event.key === 'ArrowDown' ||
      (!input && props.layout === 'carousel' && event.key === 'ArrowRight');
    const previous =
      event.key === 'ArrowUp' ||
      (!input && props.layout === 'carousel' && event.key === 'ArrowLeft');
    if (next || previous) {
      event.preventDefault();
      step(next ? 1 : -1);
      const item = selected();
      if (item) {
        const option = document.getElementById(itemId(item));
        if (props.layout !== 'carousel')
          option?.scrollIntoView({ block: 'nearest' });
        if (
          !input &&
          event.target instanceof HTMLElement &&
          event.target.closest('[data-create-card], [data-create-option]')
        )
          option?.focus({ preventScroll: true });
      }
    } else if (
      event.key === 'Enter' &&
      (input ||
        event.target === root ||
        (event.target instanceof HTMLElement &&
          event.target.closest('[data-create-card], [data-create-option]')))
    ) {
      event.preventDefault();
      c.selectSelected();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      changeQuery('');
    }
  }

  return (
    <div
      ref={root}
      tabindex={-1}
      data-keyboard-input
      on:keydown={onKeyDown}
      class={cn(
        'relative isolate flex w-full flex-col overflow-hidden rounded-3xl border border-edge-muted/60 bg-dialog text-ink outline-none [--color-surface:var(--color-dialog)]',
        props.layout === 'list' && 'h-[32rem]'
      )}
    >
      <CommandMenuShell.Header>
        <SearchIcon class="size-4 shrink-0 text-ink-extra-muted" />
        <CommandMenuSearchInput
          aria-label={`Search ${props.layout} create options`}
          type="text"
          autocomplete="off"
          placeholder="Search create options"
          value={query()}
          onInput={(event) => changeQuery(event.currentTarget.value)}
        />
      </CommandMenuShell.Header>
      <Show
        when={items().length}
        fallback={
          <div class="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 px-5 text-sm text-ink-muted">
            <p>No matches for “{query()}”</p>
            <button
              type="button"
              class="rounded-md border border-edge-muted px-3 py-1.5 text-ink hover:bg-hover"
              onClick={() => changeQuery('')}
            >
              Clear search
            </button>
          </div>
        }
      >
        <Show when={props.layout === 'list'}>
          <CommandMenuList
            items={items()}
            selectedIndex={c.selectedIndex()}
            itemId={itemId}
            class="min-h-0 max-h-none flex-1 overflow-y-auto p-2.5"
            onSelect={props.onChoose}
            onItemMouseMove={c.setSelectedIndexFromPointer}
          >
            {(item, index) => (
              <LauncherMenuItem
                creatableBlock={item}
                selected={c.isSelected(index())}
                showHotkey={false}
              />
            )}
          </CommandMenuList>
        </Show>
        <Show when={props.layout === 'details'}>
          <LauncherDetails
            sections={sections()}
            items={items()}
            selectedIndex={c.selectedIndex()}
            itemId={itemId}
            onSelect={c.setSelectedIndexFromPointer}
            onChoose={props.onChoose}
            detailsLeft={props.detailsLeft}
          />
        </Show>
        <Show when={props.layout === 'carousel'}>
          <CarouselCards
            items={items()}
            selectedIndex={c.selectedIndex()}
            itemId={itemId}
            onSelect={c.setSelectedIndex}
            onStep={step}
            onChoose={props.onChoose}
          />
        </Show>
      </Show>
      <Show when={props.layout !== 'carousel'}>
        <div class="flex h-9 shrink-0 items-center gap-4 px-5 text-xs text-ink-extra-muted">
          <span>↑ ↓ Navigate</span>
          <span>↵ Choose</span>
        </div>
      </Show>
    </div>
  );
}
