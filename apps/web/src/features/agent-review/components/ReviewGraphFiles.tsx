import { DiffCounts } from '@app/components/diff-view/DiffCounts';
import FileIcon from '@phosphor/file-code.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { GraphFile } from '../core/graph-changes';
import type { CodeLocation } from '../core/model';

/** A bounded file browser inside a card, also used by the keyboard map links. */
export function ReviewGraphFiles(props: {
  files: GraphFile[];
  keyboard?: boolean;
  onLocation: (location: CodeLocation) => void;
}) {
  let scroller!: HTMLDivElement;
  const [search, setSearch] = createSignal('');
  let pinching = false;
  const touch = (event: TouchEvent) => {
    pinching ||= event.touches.length > 1;
    if (!pinching) event.stopPropagation();
    if (!event.touches.length) pinching = false;
  };
  const files = createMemo(() => {
    const query = search().trim().toLowerCase();
    return props.files.filter((file) =>
      file.path.toLowerCase().includes(query)
    );
  });
  const virtualizer = createVirtualizer({
    get count() {
      return files().length;
    },
    getScrollElement: () => scroller,
    estimateSize: () => 44,
    getItemKey: (index) => files()[index]?.path ?? index,
    overscan: 3,
  });
  return (
    <div
      class="pointer-events-auto flex max-h-96 min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel"
      data-graph-files
      on:pointerdown={(event) => event.stopPropagation()}
      on:mousedown={(event) => event.stopPropagation()}
      on:touchstart={touch}
      on:touchmove={touch}
      on:touchend={touch}
      on:touchcancel={touch}
      on:keydown={(event) => {
        if (event.key !== 'Escape') event.stopPropagation();
        else if (search()) {
          event.preventDefault();
          event.stopPropagation();
          setSearch('');
          virtualizer.scrollToOffset(0);
        }
      }}
    >
      <Show when={props.files.length > 8}>
        <label class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2 text-ink-muted">
          <SearchIcon class="size-3 shrink-0" />
          <input
            aria-label="Find a component file"
            tabIndex={props.keyboard ? 0 : -1}
            class="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-placeholder"
            placeholder="Find a file…"
            value={search()}
            onInput={(event) => {
              setSearch(event.currentTarget.value);
              virtualizer.scrollToOffset(0);
            }}
          />
        </label>
      </Show>
      <div
        ref={scroller}
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ 'touch-action': 'pan-y' }}
        tabIndex={props.keyboard ? 0 : -1}
        role="group"
        aria-label="Component files"
      >
        <div
          class="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(row) => (
              <Show when={files()[row.index]}>
                {(file) => (
                  <button
                    type="button"
                    tabIndex={props.keyboard ? 0 : -1}
                    title={file().path}
                    class="absolute inset-x-0 top-0 flex h-11 items-center gap-2 border-b border-edge-muted/50 px-3 text-left outline-none last:border-0 hover:bg-hover focus-visible:bg-hover"
                    style={{ transform: `translateY(${row.start}px)` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onLocation(file().location);
                    }}
                  >
                    <FileIcon class="size-3.5 shrink-0 text-ink-subtle" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-mono text-[11px] leading-4 text-ink">
                        {file().path.split('/').at(-1)}
                      </span>
                      <span class="block truncate text-[10px] leading-3 text-ink-subtle">
                        {file().path.split('/').slice(0, -1).join('/') || '/'}
                      </span>
                    </span>
                    <span class="text-[10px]">
                      <DiffCounts
                        additions={file().added}
                        deletions={file().removed}
                      />
                    </span>
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
        <Show when={!files().length}>
          <p class="px-3 py-4 text-xs text-ink-muted">No matching files.</p>
        </Show>
      </div>
    </div>
  );
}
