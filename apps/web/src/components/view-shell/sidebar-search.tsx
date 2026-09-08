import SearchIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal } from 'solid-js';

/** Sidebar-local search preserves the content pane and restores navigation on close. */
export function createSidebarSearch() {
  const [isOpen, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let input: HTMLInputElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const open = () => {
    setOpen(true);
    queueMicrotask(() => input?.focus());
  };
  const close = () => {
    setQuery('');
    setOpen(false);
    queueMicrotask(() => trigger?.focus());
  };
  return {
    isOpen,
    query,
    setQuery,
    open,
    close,
    inputRef: (element: HTMLInputElement) => {
      input = element;
    },
    triggerRef: (element: HTMLButtonElement) => {
      trigger = element;
    },
  };
}

type SearchState = ReturnType<typeof createSidebarSearch>;

export function SidebarSearchToggle(props: {
  search: SearchState;
  label: string;
  size?: 'icon-sm' | 'icon-md';
}) {
  return (
    <Button
      ref={props.search.triggerRef}
      variant="ghost"
      size={props.size ?? 'icon-md'}
      class="rounded-lg text-ink-muted"
      label={props.label}
      aria-expanded={props.search.isOpen()}
      onClick={() =>
        props.search.isOpen() ? props.search.close() : props.search.open()
      }
    >
      <SearchIcon class="size-4.5" />
    </Button>
  );
}

export function SidebarSearchField(props: {
  search: SearchState;
  label: string;
}) {
  return (
    <div class="shrink-0 px-4 py-4">
      <div class="flex h-9 items-center gap-2 rounded-lg border border-edge-muted px-3 focus-within:ring-2 focus-within:ring-accent/20">
        <SearchIcon class="size-4 shrink-0 text-ink-muted" />
        <input
          ref={props.search.inputRef}
          type="search"
          aria-label={props.label}
          placeholder={props.label}
          value={props.search.query()}
          onInput={(event) => props.search.setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              props.search.close();
            }
          }}
          class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-extra-muted"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          label="Close sidebar search"
          onClick={props.search.close}
        >
          <XIcon class="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
