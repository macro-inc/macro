import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { cn, Dropdown } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import {
  SearchableMultiSelectInline,
  type SearchableOption,
} from './searchable-multi-select';

export const TypeIndicator = (props: { active: boolean }) => (
  <span
    class={cn(
      'size-3.5 flex items-center justify-center shrink-0 rounded-sm border text-surface',
      props.active
        ? 'bg-accent border-accent'
        : 'border-transparent group-hover:not-hover:border-edge-muted group-data-highlighted:not-hover:border-edge-muted hover:border-accent'
    )}
  >
    <Show when={props.active}>
      <CheckIcon class="size-2.5" />
    </Show>
  </span>
);

/** The option row shared by legacy and composable app-view filters. */
export function FilterOptionItem(props: {
  label: string;
  icon?: () => JSX.Element;
  active: boolean;
  disabled?: boolean;
  closeOnSelect?: boolean;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item
      role="menuitemcheckbox"
      aria-checked={props.active}
      disabled={props.disabled}
      onSelect={props.onSelect}
      closeOnSelect={props.closeOnSelect}
    >
      <TypeIndicator active={props.active} />
      <Show when={props.icon}>
        {(icon) => (
          <span class="size-4 flex items-center justify-center shrink-0">
            {icon()()}
          </span>
        )}
      </Show>
      <span
        class={cn(
          'flex-1 truncate',
          props.active ? 'text-ink' : 'text-ink-muted'
        )}
      >
        {props.label}
      </span>
    </Dropdown.Item>
  );
}

function FilterCategoryLabel(props: { label: string; active: boolean }) {
  return (
    <>
      <span class="flex-1 text-ink">{props.label}</span>
      <Show when={props.active}>
        <span
          aria-hidden="true"
          class="size-1.5 shrink-0 rounded-full bg-accent"
        />
      </Show>
      <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
    </>
  );
}

export function FilterSubmenu<TId extends string>(props: {
  label: string;
  active?: boolean;
  options: {
    id: TId;
    label: string;
    icon?: () => JSX.Element;
    disabled?: boolean;
  }[];
  isSelected: (id: TId) => boolean;
  onSelect: (id: TId) => void;
  closeOnSelect?: boolean;
  contentClass?: string;
  selectionMode?: 'single' | 'multiple';
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger>
        <FilterCategoryLabel
          label={props.label}
          active={
            props.active ??
            props.options.some((option) => props.isSelected(option.id))
          }
        />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent class={props.contentClass}>
        <Dropdown.Group>
          <Show
            when={props.selectionMode === 'single'}
            fallback={
              <For each={props.options}>
                {(option) => (
                  <FilterOptionItem
                    label={option.label}
                    icon={option.icon}
                    disabled={option.disabled}
                    active={props.isSelected(option.id)}
                    onSelect={() => props.onSelect(option.id)}
                    closeOnSelect={props.closeOnSelect}
                  />
                )}
              </For>
            }
          >
            <Dropdown.RadioGroup
              value={
                props.options.find((option) => props.isSelected(option.id))?.id
              }
              onChange={(id) => {
                const option = props.options.find((option) => option.id === id);
                if (option) props.onSelect(option.id);
              }}
            >
              <For each={props.options}>
                {(option) => (
                  <Dropdown.RadioItem
                    value={option.id}
                    disabled={option.disabled}
                    closeOnSelect={props.closeOnSelect}
                  >
                    <Show when={option.icon}>
                      <span class="size-4 flex items-center justify-center shrink-0">
                        {option.icon?.()}
                      </span>
                    </Show>
                    <span class="flex-1">{option.label}</span>
                    <Dropdown.ItemIndicator>
                      <CheckIcon class="size-3.5 text-accent" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Show>
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}

/** Searchable submenu for filters with many options like assignees */
export const SearchableFilterSubmenu = (props: {
  label: string;
  active?: boolean;
  options: Accessor<SearchableOption[]>;
  activeIds: Accessor<string[]>;
  onChange: (ids: string[]) => void;
  placeholder?: string;
  open?: Accessor<boolean>;
  onOpenChange?: (v: boolean) => void;
  /** Keep `options` in their given order instead of pinning selected first. */
  preserveOrder?: boolean;
}) => {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const isOpen = () => props.open?.() ?? internalOpen();
  const setIsOpen = (v: boolean) => {
    if (props.onOpenChange) props.onOpenChange(v);
    else setInternalOpen(v);
  };
  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();

  // Focus the search input while the sub is open.
  //
  // Two issues conspire:
  //   1. Initial focus has to wait for Kobalte's DismissableLayer to register
  //      itself as a nested layer of the parent menu (done in its onMount).
  //      The sub is portaled, so focusing the input before that registration
  //      looks like "focus outside" to the parent and closes the whole menu
  //      tree. One rAF is enough to get past those onMount callbacks.
  //   2. After that, Kobalte's `onPointerMove` on the SubTrigger keeps
  //      calling `focusWithoutScrolling(e.currentTarget)` on every mouse
  //      move, stealing focus back to the trigger. Reclaim on blur — user
  //      dismissal routes (Escape / click-outside) close the sub first,
  //      which unregisters this listener before focus moves elsewhere.
  createEffect(() => {
    const el = inputRef();
    if (!isOpen() || !el) return;

    const raf = requestAnimationFrame(() => {
      if (isOpen()) el.focus();
    });

    const onBlur = () => {
      queueMicrotask(() => {
        if (isOpen() && document.activeElement !== el) el.focus();
      });
    };
    el.addEventListener('blur', onBlur);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      el.removeEventListener('blur', onBlur);
    });
  });

  return (
    <Dropdown.Sub open={isOpen()} onOpenChange={setIsOpen}>
      <Dropdown.SubTrigger
        onPointerEnter={(e: PointerEvent & { currentTarget: HTMLElement }) => {
          // Kobalte's "grace polygon" keeps an open sub alive when the
          // pointer crosses toward its content. For sibling In/From triggers,
          // that means moving between them leaves the prior sub stuck open
          // and the prior trigger stuck with data-highlighted. Force focus
          // + open so Kobalte's parent selection manager updates to this
          // trigger and the shared signal closes the sibling.
          if (e.pointerType !== 'mouse') return;
          e.currentTarget.focus({ preventScroll: true });
          if (!isOpen()) setIsOpen(true);
        }}
      >
        <FilterCategoryLabel
          label={props.label}
          active={props.active ?? props.activeIds().length > 0}
        />
      </Dropdown.SubTrigger>

      <Dropdown.SubContent class="w-65 max-w-[90vw]">
        <Dropdown.Group class="p-0 gap-0">
          <SearchableMultiSelectInline
            onRequestClose={() => setIsOpen(false)}
            placeholder={props.placeholder}
            activeIds={props.activeIds}
            onChange={props.onChange}
            options={props.options}
            inputRef={setInputRef}
            preserveOrder={props.preserveOrder}
          />
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
};
