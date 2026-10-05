/**
 * The actions menu (⌘P, as Figma's quick actions): every action with a
 * shortcut, searched by name, run with Enter. It opens above the toolbar.
 */

import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import { createSignal, For, onMount, Show } from 'solid-js';
import { paletteActions } from '../core/palette';
import type { ViewerAction } from '../core/shortcuts';

export function ActionsPalette(props: {
  mac: boolean;
  /** Whether an action can run now (edits need an editable file). */
  available: (action: ViewerAction) => boolean;
  onRun: (action: ViewerAction) => void;
  /** `refocus`: closed from the menu itself (not by focus leaving it). */
  onClose: (refocus: boolean) => void;
}) {
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;

  const results = () =>
    paletteActions(query()).filter((a) => props.available(a.id));
  const keysFor = (keys: string[], other?: string[]) =>
    (!props.mac && other ? other : keys).map((k) =>
      k === 'mod' ? (props.mac ? '⌘' : 'Ctrl') : k
    );

  const search = (text: string) => {
    setQuery(text);
    setActive(0);
  };
  const move = (step: number) => {
    const count = results().length;
    if (count === 0) return;
    const next = (active() + step + count) % count;
    setActive(next);
    list
      .querySelector(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (action: ViewerAction | undefined) => {
    if (!action) return;
    props.onClose(true);
    props.onRun(action);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'ArrowDown') {
      handled();
      move(1);
    } else if (e.key === 'ArrowUp') {
      handled();
      move(-1);
    } else if (e.key === 'Enter') {
      handled();
      choose(results()[active()]?.id);
    } else if (e.key === 'Escape') {
      handled();
      props.onClose(true);
    }
  };

  onMount(() => input.focus({ preventScroll: true }));

  return (
    <div
      role="dialog"
      aria-label="Actions"
      data-testid="fig-actions"
      class="absolute inset-x-4 bottom-16 z-20 mx-auto flex max-h-[60%] max-w-md flex-col overflow-hidden rounded-xl border border-edge-muted bg-menu text-ink text-xs shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
      onFocusOut={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !e.currentTarget.contains(next)) props.onClose(false);
      }}
    >
      <div class="flex items-center gap-2 border-edge-muted border-b px-3 py-2">
        <MagnifyingGlass class="size-3.5 shrink-0 text-ink-muted" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="fig-actions-list"
          aria-activedescendant={`fig-action-${active()}`}
          placeholder="Search actions"
          class="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
          data-testid="fig-actions-input"
          value={query()}
          onInput={(e) => search(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div
        ref={list}
        id="fig-actions-list"
        role="listbox"
        class="min-h-0 flex-1 overflow-y-auto p-1"
      >
        <For each={results()}>
          {(item, index) => (
            <div
              id={`fig-action-${index()}`}
              role="option"
              aria-selected={index() === active()}
              data-index={index()}
              data-testid={`fig-action-${item.id}`}
              class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5"
              classList={{ 'bg-hover': index() === active() }}
              onPointerMove={() => setActive(index())}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(item.id)}
            >
              <span class="min-w-0 truncate">
                {item.label}
                <span class="ml-2 text-ink-muted">{item.group}</span>
              </span>
              <span class="flex shrink-0 gap-0.5">
                <For each={keysFor(item.keys, item.otherKeys)}>
                  {(k) => (
                    <kbd class="rounded border border-edge-muted bg-inset px-1 font-sans">
                      {k}
                    </kbd>
                  )}
                </For>
              </span>
            </div>
          )}
        </For>
        <Show when={results().length === 0}>
          <div class="px-2 py-3 text-center text-ink-muted">
            No matching actions
          </div>
        </Show>
      </div>
    </div>
  );
}
