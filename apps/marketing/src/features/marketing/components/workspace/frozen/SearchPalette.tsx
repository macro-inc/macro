import Search from '@phosphor/magnifying-glass.svg';
import { Dialog } from '@ui/components/Dialog';
import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

const CATEGORIES = [
  'All',
  'Command',
  'Agents',
  'Files',
  'Tasks',
  'Projects',
  'Channels',
  'People',
] as const;
export type SearchOption = {
  id: string;
  title: string;
  category: (typeof CATEGORIES)[number];
  icon: (props: { class?: string }) => JSX.Element;
  run: () => void;
  shortcut?: string;
};

/** The live ⌘K presentation, searching only the local sample workspace. */
export function SearchPalette(props: {
  options: SearchOption[];
  mount: HTMLElement;
  onClose: () => void;
}) {
  const id = createUniqueId();
  const [query, setQuery] = createSignal('');
  const [category, setCategory] =
    createSignal<(typeof CATEGORIES)[number]>('All');
  const [selected, setSelected] = createSignal(0);
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;
  const options = () =>
    props.options.filter(
      (option) =>
        (category() === 'All' || option.category === category()) &&
        option.title.toLowerCase().includes(query().trim().toLowerCase())
    );
  const chooseCategory = (value: (typeof CATEGORIES)[number]) => {
    setCategory(value);
    setSelected(0);
    input.focus();
  };
  const run = (option?: SearchOption) => {
    if (!option) return;
    props.onClose();
    option.run();
  };
  return (
    <Dialog
      mount={props.mount}
      open
      position="top"
      class="sample-create-palette sample-search-palette"
      onOpenChange={(open) => !open && props.onClose()}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        input.focus();
      }}
    >
      <div
        onKeyDown={(event) => {
          if (
            event.isComposing ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey
          )
            return;
          if (event.key === 'Tab') {
            event.preventDefault();
            const next =
              (CATEGORIES.indexOf(category()) +
                (event.shiftKey ? CATEGORIES.length - 1 : 1)) %
              CATEGORIES.length;
            chooseCategory(CATEGORIES[next]);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const count = options().length;
            setSelected(
              count
                ? (selected() + (event.key === 'ArrowDown' ? 1 : count - 1)) %
                    count
                : 0
            );
            list.children[selected()]?.scrollIntoView({ block: 'nearest' });
          } else if (event.key === 'Enter' && event.target === input) {
            event.preventDefault();
            run(options()[selected()]);
          }
        }}
      >
        <Dialog.Title class="sr-only">Search workspace</Dialog.Title>
        <Dialog.Description class="sr-only">
          Find files, tasks, agents, channels, and people in the sample
          workspace.
        </Dialog.Description>
        <div class="flex items-center gap-3 px-5 py-3 min-h-14 border-b border-edge-muted">
          <Search class="size-4 shrink-0 text-accent" />
          <input
            ref={input}
            role="combobox"
            aria-label="Search workspace"
            aria-controls={`${id}-results`}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={
              options().length ? `${id}-${selected()}` : undefined
            }
            placeholder="Search…"
            class="min-w-0 flex-1 border-0 bg-transparent outline-none text-sm text-ink placeholder:text-ink-placeholder"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setSelected(0);
            }}
          />
        </div>
        <div
          role="radiogroup"
          aria-label="Search category"
          class="flex gap-1 overflow-x-auto px-2 py-2"
        >
          <For each={CATEGORIES}>
            {(value) => (
              <button
                type="button"
                role="radio"
                aria-checked={category() === value}
                tabindex={-1}
                class="sample-search-category shrink-0 rounded-full px-3 py-1.5 text-xs text-ink-muted"
                onClick={() => chooseCategory(value)}
              >
                {value}
              </button>
            )}
          </For>
        </div>
        <div
          ref={list}
          id={`${id}-results`}
          role="listbox"
          aria-label="Search results"
          class="max-h-[min(46vh,22rem)] overflow-y-auto p-2"
        >
          <For each={options()}>
            {(option, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-${index()}`}
                aria-selected={selected() === index()}
                tabindex={-1}
                class="sample-create-option rounded-md w-full flex items-center h-10 px-2 gap-3 text-sm text-left"
                onMouseMove={() => setSelected(index())}
                onClick={() => run(option)}
              >
                <Dynamic
                  component={option.icon}
                  class="size-4 shrink-0 text-ink-extra-muted"
                />
                <span class="min-w-0 truncate font-medium">{option.title}</span>
                <Show when={option.shortcut}>
                  <kbd class="ml-auto text-xs text-ink-extra-muted">
                    {option.shortcut}
                  </kbd>
                </Show>
              </button>
            )}
          </For>
        </div>
        <Show when={!options().length}>
          <p class="p-6 text-center text-sm text-ink-muted">
            No matching items.
          </p>
        </Show>
        <div class="flex gap-4 px-5 py-3 border-t border-edge-muted text-xs text-ink-extra-muted">
          <span>↑ ↓ &nbsp; Navigate</span>
          <span>↵ &nbsp; Run action</span>
          <span>Tab &nbsp; Category</span>
          <span>Esc &nbsp; Close</span>
        </div>
      </div>
    </Dialog>
  );
}
