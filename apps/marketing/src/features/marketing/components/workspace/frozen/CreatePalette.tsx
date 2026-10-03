import Search from '@phosphor/magnifying-glass.svg';
import Plus from '@phosphor/plus.svg';
import { Dialog } from '@ui/components/Dialog';
import { ToggleSwitch } from '@ui/components/ToggleSwitch';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type CreateOption = {
  label: string;
  key: string;
  hint?: string;
  icon: (props: { class?: string }) => JSX.Element;
  run: () => void;
};

/** Launcher / CommandMenuPrimitives presentation, with local demo actions. */
export function CreatePalette(props: {
  options: CreateOption[];
  mount: HTMLElement;
  onClose: () => void;
}) {
  const [searchMode, setSearchMode] = createSignal(true);
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(0);
  let search!: HTMLInputElement;
  let shell!: HTMLDivElement;
  let list!: HTMLDivElement;
  const options = () =>
    props.options.filter((option) =>
      `${option.label} ${option.hint ?? ''}`
        .toLowerCase()
        .includes(query().toLowerCase())
    );
  const run = (option?: CreateOption) => {
    if (!option) return;
    props.onClose();
    option.run();
  };
  const toggle = (enabled: boolean) => {
    setSearchMode(enabled);
    setQuery('');
    setSelected(0);
    queueMicrotask(() => (enabled ? search : shell)?.focus());
  };
  return (
    <Dialog
      mount={props.mount}
      open
      onOpenChange={(open) => !open && props.onClose()}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        search?.focus();
      }}
      class="sample-create-palette"
      position="top"
    >
      <div
        ref={shell}
        tabindex={-1}
        class="outline-none"
        onKeyDown={(event) => {
          if (
            event.isComposing ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey
          )
            return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const count = options().length;
            setSelected(
              count
                ? (selected() + (event.key === 'ArrowDown' ? 1 : count - 1)) %
                    count
                : 0
            );
            list.children[selected()]?.scrollIntoView({ block: 'nearest' });
          } else if (
            event.key === 'Enter' &&
            (event.target === search || event.target === shell)
          ) {
            event.preventDefault();
            run(options()[selected()]);
          } else if (
            event.key === '/' &&
            (event.target === shell || !query())
          ) {
            event.preventDefault();
            toggle(!searchMode());
          } else if (!searchMode() && event.target === shell) {
            const option = props.options.find(
              (item) => item.key === event.key.toLowerCase()
            );
            if (option) {
              event.preventDefault();
              run(option);
            }
          }
        }}
      >
        <Dialog.Title class="sr-only">Create New</Dialog.Title>
        <Dialog.Description class="sr-only">
          Choose what to create in the sample workspace.
        </Dialog.Description>
        <div class="flex items-center gap-3 px-5 py-3 min-h-14">
          <Show
            when={searchMode()}
            fallback={
              <div class="min-w-0 flex flex-1 items-center gap-2 text-ink-muted">
                <Plus class="size-4" />
                <span>Create New</span>
              </div>
            }
          >
            <div class="min-w-0 flex flex-1 items-center gap-2">
              <Search class="size-4 shrink-0 text-ink-extra-muted" />
              <input
                ref={search}
                role="combobox"
                aria-label="Search create options"
                aria-controls="sample-create-options"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-activedescendant={
                  options().length ? `sample-create-${selected()}` : undefined
                }
                placeholder="Search create options"
                value={query()}
                class="min-w-0 w-full flex-1 py-0.5 bg-transparent border-0 outline-none text-sm text-ink-muted placeholder:text-ink-placeholder"
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setSelected(0);
                }}
              />
            </div>
          </Show>
          <ToggleSwitch
            checked={searchMode()}
            onChange={toggle}
            size="xs"
            label={
              <span class="flex items-center gap-1 text-[11px] font-medium text-ink-extra-muted/70">
                Search mode <kbd class="px-2 py-0.5">/</kbd>
              </span>
            }
            labelClass="flex items-center"
            controlClass="bg-ink-extra-muted/25 data-checked:bg-accent"
            class="ml-auto flex-row-reverse gap-1.5"
          />
        </div>
        <div
          ref={list}
          id="sample-create-options"
          role="listbox"
          aria-label="Create options"
          class="max-h-[min(60vh,26rem)] overflow-y-auto p-2"
        >
          <For each={options()}>
            {(option, index) => (
              <button
                type="button"
                role="option"
                id={`sample-create-${index()}`}
                aria-selected={selected() === index()}
                tabindex={-1}
                class="sample-create-option rounded-md w-full flex items-center h-10 px-2 gap-2 text-sm text-left"
                onMouseMove={() => setSelected(index())}
                onClick={() => run(option)}
              >
                <Dynamic
                  component={option.icon}
                  class="size-4 shrink-0 text-ink-extra-muted"
                />
                <span class="font-medium text-ink">{option.label}</span>
                <Show when={option.hint}>
                  <span class="min-w-0 truncate text-ink-extra-muted/70">
                    {option.hint}
                  </span>
                </Show>
                <Show when={!searchMode()}>
                  <kbd class="ml-auto border border-edge-muted rounded-md px-1.5 text-xs text-ink-muted">
                    {option.key.toUpperCase()}
                  </kbd>
                </Show>
              </button>
            )}
          </For>
          <Show when={!options().length}>
            <p class="p-4 text-center text-sm text-ink-muted">
              No matching create options
            </p>
          </Show>
        </div>
        <div class="flex gap-4 px-5 py-2 border-t border-edge-muted text-xs text-ink-extra-muted/80">
          <span>↑ ↓ &nbsp; Navigate</span>
          <span>↵ &nbsp; Create</span>
          <span>Esc &nbsp; Close</span>
        </div>
      </div>
    </Dialog>
  );
}
