import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { useSelectedFirst } from '@core/util/useSelectedFirst';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import type { CollectionNode } from '@kobalte/core';
import { Combobox, useComboboxContext } from '@kobalte/core/combobox';
import { makeEventListener } from '@solid-primitives/event-listener';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { cn, Layer } from '@ui';
import { MultiSelectItemContent } from '@ui/components/MultiSelectItemContent';
import {
  applyMultiSelectSelection,
  createMultiSelectIntent,
} from '@ui/utils/multiSelectSelection';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { SearchableOptionSource } from './option-source';

export type SearchableOption<TId extends string = string> = {
  id: TId;
  label: string;
  icon?: () => JSX.Element;
  /** Drawn in place of `label`, which still drives search. */
  content?: () => JSX.Element;
  disabled?: boolean;
};

export type SearchableSelectAction = {
  label: string;
  icon?: () => JSX.Element;
  onSelect: () => void;
};

/**
 * Sentinel id for the action row. It rides the option collection so kobalte's
 * arrow-key highlighting and Enter-to-select reach it like any other row, but
 * "selecting" it fires `action.onSelect` and closes the menu instead of
 * toggling the multi-select value.
 */
const ACTION_ID = '__searchable-multi-select-action__';

const ITEM_HEIGHT = 36;
const LISTBOX_CLASS = 'max-h-[240px] overflow-y-auto scrollbar-hidden';

type SearchableMultiSelectProps = {
  source?: SearchableOptionSource;
  options: Accessor<SearchableOption[]>;
  activeIds: Accessor<string[]>;
  onChange: (ids: string[]) => void;
  placeholder?: string;
  placement?:
    | 'bottom-start'
    | 'bottom-end'
    | 'top-start'
    | 'top-end'
    | 'right-start'
    | 'left-start';
  gutter?: number;
  contentClass?: string;
  portalScope?: 'local';
  listboxClass?: string;
  /** Keep `options` in their given order instead of pinning selected first. */
  preserveOrder?: boolean;
  /** Optional Only/All behavior for tri-state filters such as inboxes. */
  onOnly?: (id: string) => void;
  /** Non-toggling action row appended after the options. */
  action?: SearchableSelectAction;
  open?: Accessor<boolean>;
  onOpenChange?: (open: boolean) => void;
  children: JSX.Element;
  footer?: JSX.Element;
};

// Options use virtual focus. A native pointer focus would land on the enclosing
// dialog, dismissing the combobox before its pointer-up selection handler runs.
const keepComboboxFocus = (event: Event) => event.preventDefault();

function PickerSearchInput(props: {
  placeholder?: string;
  value?: string;
  onInput?: JSX.EventHandler<HTMLInputElement, InputEvent>;
  onKeyDown?: (event: KeyboardEvent) => void;
  onReady?: (input: HTMLInputElement) => void;
}) {
  return (
    <Combobox.Input
      ref={props.onReady}
      value={props.value}
      onInput={props.onInput}
      onKeyDown={props.onKeyDown}
      class="flex-1 min-w-0 text-sm bg-transparent outline-none caret-accent placeholder:text-ink-placeholder"
      placeholder={props.placeholder ?? 'Search...'}
    />
  );
}

const SearchableMultiSelectItem = (itemProps: {
  item: CollectionNode<SearchableOption>;
  onOnly?: (id: string) => void;
  isSoleActive?: (id: string) => boolean;
  selectionIntent: ReturnType<typeof createMultiSelectIntent>;
}) => {
  const combobox = useComboboxContext();
  let selectedOnPointerUp = false;
  const toggle = () =>
    combobox.listState().selectionManager().toggleSelection(itemProps.item.key);
  return (
    <Combobox.Item
      as="li"
      item={itemProps.item}
      ref={(element) => {
        itemProps.selectionIntent.track(element);
        // Intercept Shift activation before Kobalte selects a range. The change
        // handler turns the resulting single-item toggle into exclusive selection.
        const intercept = (event: Event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        const isOnlyButton = (event: Event) =>
          event.target instanceof Element && event.target.closest('button');
        makeEventListener(
          element,
          'pointerdown',
          () => {
            selectedOnPointerUp = false;
          },
          true
        );
        makeEventListener(
          element,
          'pointerup',
          (event: PointerEvent) => {
            if (
              !event.shiftKey ||
              isOnlyButton(event) ||
              event.pointerType !== 'mouse' ||
              event.button !== 0
            )
              return;
            intercept(event);
            selectedOnPointerUp = true;
            toggle();
          },
          true
        );
        makeEventListener(
          element,
          'click',
          (event: MouseEvent) => {
            if (!event.shiftKey || isOnlyButton(event)) return;
            intercept(event);
            if (!selectedOnPointerUp) toggle();
            selectedOnPointerUp = false;
          },
          true
        );
        makeEventListener(
          element,
          'keydown',
          (event: KeyboardEvent) => {
            if (
              !event.shiftKey ||
              isOnlyButton(event) ||
              (event.key !== 'Enter' && event.key !== ' ')
            )
              return;
            intercept(event);
            if (!event.repeat) toggle();
          },
          true
        );
      }}
      aria-label={itemProps.item.rawValue.label}
      aria-keyshortcuts="Space Enter Shift+Enter"
      onPointerDown={keepComboboxFocus}
      onMouseDown={keepComboboxFocus}
      class={cn(
        'group relative rounded-lg w-full flex items-center gap-1.5 p-1.5 px-2 text-left text-sm font-normal data-highlighted:bg-ink/5 cursor-default touch:min-h-11',
        itemProps.item.rawValue.id !== ACTION_ID && 'pr-14'
      )}
    >
      <Show
        when={itemProps.item.rawValue.id !== ACTION_ID}
        fallback={
          <>
            <Show when={itemProps.item.rawValue.icon}>
              {(icon) => (
                <span class="size-4 flex items-center justify-center shrink-0">
                  {icon()()}
                </span>
              )}
            </Show>
            <Combobox.ItemLabel class="flex-1 truncate text-ink">
              {itemProps.item.rawValue.label}
            </Combobox.ItemLabel>
          </>
        }
      >
        <MultiSelectItemContent
          checked={combobox
            .listState()
            .selectionManager()
            .isSelected(itemProps.item.key)}
          label={itemProps.item.rawValue.label}
          disabled={itemProps.item.rawValue.disabled}
          onOnly={() => itemProps.onOnly?.(itemProps.item.rawValue.id)}
          onlyLabel={
            itemProps.isSoleActive?.(itemProps.item.rawValue.id)
              ? 'All'
              : 'Only'
          }
        >
          <Show when={itemProps.item.rawValue.icon}>
            {(icon) => (
              <span class="size-4 flex items-center justify-center shrink-0">
                {icon()()}
              </span>
            )}
          </Show>
          <Combobox.ItemLabel class="flex-1 truncate text-ink">
            {itemProps.item.rawValue.content?.() ??
              itemProps.item.rawValue.label}
          </Combobox.ItemLabel>
        </MultiSelectItemContent>
      </Show>
    </Combobox.Item>
  );
};

const VirtualizedListbox = (props: {
  resetScrollRef?: (reset: (() => void) | undefined) => void;
  class?: string;
  onOnly?: (id: string) => void;
  isSoleActive?: (id: string) => boolean;
  selectionIntent: ReturnType<typeof createMultiSelectIntent>;
}) => {
  let handle: VirtualizerHandle | undefined;
  let pendingFocus = false;
  let active = true;
  const combobox = useComboboxContext();
  props.resetScrollRef?.(() => {
    combobox.listState().selectionManager().setFocusedKey(undefined);
    handle?.scrollToIndex(0, { align: 'start' });
  });
  onCleanup(() => {
    active = false;
    props.resetScrollRef?.(undefined);
  });
  // Kobalte supplies the collection after applying the combobox search
  // filter. Use it for focus scrolling too — indexing the original options
  // array targets the wrong virtual row whenever the list is filtered.
  let visibleItems:
    | Accessor<Iterable<CollectionNode<SearchableOption>>>
    | undefined;
  const scrollToItem = (key: string) => {
    // Before initial measurement, "nearest" starts a corrective scroll against
    // a zero-height viewport and can keep undoing subsequent user scrolling.
    if (!handle?.viewportSize) {
      pendingFocus = true;
      return;
    }
    pendingFocus = false;
    const idx = Array.from(visibleItems?.() ?? []).findIndex(
      (item) => item.rawValue.id === key
    );
    if (idx !== -1) handle.scrollToIndex(idx, { align: 'nearest' });
  };
  const { observe } = makeResizeObserver(() => {
    // Let the virtualizer's own observer publish its viewport measurement.
    queueMicrotask(() => {
      if (!active || !pendingFocus) return;
      const key = combobox.listState().selectionManager().focusedKey();
      if (key) scrollToItem(key);
    });
  });
  return (
    <Combobox.Listbox<SearchableOption>
      ref={observe}
      scrollToItem={scrollToItem}
      class={cn(LISTBOX_CLASS, props.class)}
    >
      {(items) => {
        visibleItems = items;
        const rows = createMemo(() => [...items()]);
        return (
          <Virtualizer
            ref={(h) => {
              handle = h;
            }}
            data={rows()}
            itemSize={ITEM_HEIGHT}
          >
            {(item) => (
              <SearchableMultiSelectItem
                item={item}
                onOnly={props.onOnly}
                isSoleActive={props.isSoleActive}
                selectionIntent={props.selectionIntent}
              />
            )}
          </Virtualizer>
        );
      }}
    </Combobox.Listbox>
  );
};

/**
 * Tracks whether any option matches the search query. Used to toggle the
 * "no results" message. Precomputes lowercased labels so substring matching
 * on each keystroke isn't O(n) toLowerCase calls.
 */
const useHasMatches = (
  options: Accessor<SearchableOption[]>,
  searchQuery: Accessor<string>
) => {
  const lowered = createMemo(() =>
    options().map((opt) => opt.label.toLowerCase())
  );
  return createMemo(() => {
    const q = searchQuery().trim().toLowerCase();
    if (!q) return options().length > 0;
    return lowered().some((label) => label.includes(q));
  });
};

const useActiveOptions = (
  options: Accessor<SearchableOption[]>,
  activeIds: Accessor<string[]>
) =>
  createMemo(() => {
    const ids = activeIds();
    if (ids.length === 0) return [];
    const set = new Set(ids);
    return options().filter((opt) => set.has(opt.id));
  });

const getOptionId = (opt: SearchableOption) => opt.id;

const filterWithAction = (option: SearchableOption, query: string) =>
  option.id === ACTION_ID ||
  option.label.toLowerCase().includes(query.toLowerCase());

export const SearchableMultiSelect = (props: SearchableMultiSelectProps) => {
  const [portalAnchor, setPortalAnchor] = createSignal<HTMLDivElement>();
  const selectionIntent = createMultiSelectIntent();
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const options = () => props.source?.options() ?? props.options();
  const visibleIds = createMemo(
    () => new Set(props.source?.visibleIds() ?? [])
  );
  const sourceAction = () => props.source?.error() || props.source?.hasNext();
  let resetScroll: (() => void) | undefined;
  let previousWindow: string | undefined;
  createEffect(
    on(
      () => props.source?.windowKey(),
      (window) => {
        if (window === undefined) return;
        if (previousWindow !== undefined && previousWindow !== window)
          resetScroll?.();
        previousWindow = window;
      }
    )
  );

  const isOpen = () => props.open?.() ?? internalOpen();
  const setIsOpen = (v: boolean) => {
    if (props.onOpenChange) props.onOpenChange(v);
    else setInternalOpen(v);
  };

  const activeOptions = useActiveOptions(options, props.activeIds);
  const selectedFirstOptions = useSelectedFirst({
    items: options,
    selectedIds: props.activeIds,
    searchQuery,
    getId: getOptionId,
    sortDeps: [isOpen],
  });
  const sortedOptions = () =>
    props.source || props.preserveOrder ? options() : selectedFirstOptions();
  const displayOptions = createMemo(() => {
    if (sourceAction())
      return [
        ...sortedOptions(),
        {
          id: ACTION_ID,
          label: props.source?.error()
            ? t('viewMenus.retryOptions')
            : t('viewMenus.nextOptions'),
          disabled: props.source?.loading(),
        },
      ];
    const action = props.action;
    if (!action) return sortedOptions();
    return [
      ...sortedOptions(),
      {
        id: ACTION_ID,
        label: action.label,
        icon: action.icon,
      },
    ];
  });
  const localMatches = useHasMatches(displayOptions, searchQuery);
  const hasMatches = () =>
    props.source ? visibleIds().size > 0 || sourceAction() : !!props.action || localMatches();

  const onSourceInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    event
  ) => {
    if (!props.source) return;
    setSearchQuery(event.currentTarget.value);
    props.source.setSearch(event.currentTarget.value);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchQuery('');
      props.source?.setSearch('');
    }
  };

  const handleChange = (selected: SearchableOption[]) => {
    if (props.source && selected.some((o) => o.id === ACTION_ID)) {
      if (props.source.error())
        fireAndForget(props.source.retry(), 'filter-options');
      else props.source.next();
      return;
    }
    const action = props.action;
    if (action && selected.some((o) => o.id === ACTION_ID)) {
      handleOpenChange(false);
      action.onSelect();
      return;
    }
    const id =
      selected.find((option) => !props.activeIds().includes(option.id))?.id ??
      activeOptions().find(
        (option) => !selected.some((next) => next.id === option.id)
      )?.id;
    if (id !== undefined)
      props.onChange(
        applyMultiSelectSelection(
          props.activeIds(),
          id,
          selectionIntent.intent()
        )
      );
    dismissAfterSelection();
  };

  const dismissAfterSelection = () => {
    if (selectionIntent.shouldClose())
      queueMicrotask(() => handleOpenChange(false));
  };
  const handleOnly = (id: string) => {
    if (props.onOnly) props.onOnly(id);
    else props.onChange([id]);
  };

  const isSoleActive = (id: string) => {
    const ids = props.activeIds();
    return !!props.onOnly && ids.length === 1 && ids[0] === id;
  };

  return (
    <Combobox<SearchableOption>
      multiple
      selectionBehavior="toggle"
      closeOnSelection={false}
      open={isOpen()}
      options={displayOptions()}
      defaultFilter={
        props.source
          ? (option) => option.id === ACTION_ID || visibleIds().has(option.id)
          : undefined
      }
      value={activeOptions()}
      onChange={handleChange}
      onInputChange={(value) => {
        // Kobalte also clears its input when selected option objects refresh.
        // Only native edits change a query-driven source; metadata/page
        // replacement must not cancel the user's in-flight search.
        if (!props.source) setSearchQuery(value);
      }}
      onOpenChange={handleOpenChange}
      optionValue="id"
      optionTextValue="label"
      optionLabel="label"
      defaultFilter={props.action ? filterWithAction : undefined}
      optionDisabled="disabled"
      allowsEmptyCollection
      virtualized
      removeOnBackspace={false}
      placement={props.placement ?? 'bottom-start'}
      gutter={props.gutter ?? 4}
    >
      <Combobox.Control class="flex items-center h-full">
        {props.children}
        <Combobox.Input
          ref={selectionIntent.track}
          value={props.source?.search() ?? searchQuery()}
          onInput={onSourceInput}
          class="sr-only"
        />
      </Combobox.Control>

      <div class="hidden" ref={setPortalAnchor} />
      <Combobox.Portal
        mount={
          props.portalScope === 'local'
            ? (portalAnchor()?.closest<HTMLElement>('.portal-scope') ??
              undefined)
            : undefined
        }
      >
        <Layer depth={2}>
          <Combobox.Content
            ref={selectionIntent.track}
            class={cn(
              'menu-surface z-action-menu w-65 max-w-[90vw] overflow-hidden',
              props.contentClass
            )}
          >
            <div class="flex items-center gap-2 px-3 py-2 border-b border-edge-muted">
              <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
              <PickerSearchInput
                value={props.source?.search() ?? searchQuery()}
                onInput={onSourceInput}
                placeholder={props.placeholder}
              />
            </div>
            <div class="p-1">
              <Show when={props.source}>
                {(source) => <SearchableSourceStatus source={source()} />}
              </Show>
              <Show
                when={hasMatches()}
                fallback={
                  <div class="py-3 px-2 text-center text-xs text-ink-muted">
                    <Show when={!props.source}>
                      {searchQuery().trim()
                        ? `No options match "${searchQuery()}"`
                        : 'No options available'}
                    </Show>
                  </div>
                }
              >
                <VirtualizedListbox
                  class={props.listboxClass}
                  resetScrollRef={(reset) => {
                    resetScroll = reset;
                  }}
                  onOnly={handleOnly}
                  isSoleActive={isSoleActive}
                  selectionIntent={selectionIntent}
                />
              </Show>
            </div>
            {props.footer}
          </Combobox.Content>
        </Layer>
      </Combobox.Portal>
    </Combobox>
  );
};

/** Shared status for bounded menu and drawer windows; an empty page may continue. */
export function SearchableSourceStatus(props: {
  source: SearchableOptionSource;
}) {
  return (
    <div class="px-2 text-xs text-ink-muted">
      <Show when={props.source.loading()}>
        <div role="status" class="py-2">
          {t('common.loadingOptions')}
        </div>
      </Show>
      <Show when={props.source.error()}>
        <div role="status" class="py-2">
          {t('common.optionsUnavailable')}
        </div>
      </Show>
      <Show when={props.source.incomplete()}>
        <div role="status" class="py-2">
          {t('common.optionsIncomplete')}
        </div>
      </Show>
      <Show
        when={
          !props.source.loading() &&
          !props.source.error() &&
          props.source.visibleIds().length === 0
        }
      >
        <div role="status" class="py-2">
          {t('common.noOptionsInWindow')}
        </div>
      </Show>
    </div>
  );
}

type SearchableMultiSelectInlineProps = {
  /** Already filtered/ranked by a bounded source; never substring-filter again. */
  source?: SearchableOptionSource;
  options: Accessor<SearchableOption[]>;
  activeIds: Accessor<string[]>;
  onChange: (ids: string[]) => void;
  placeholder?: string;
  inputRef?: (el: HTMLInputElement) => void;
  onRequestClose?: () => void;
  onSelectionComplete?: () => void;
  listboxClass?: string;
  /** Keep `options` in their given order instead of pinning selected first. */
  preserveOrder?: boolean;
  footer?: JSX.Element;
};

/**
 * Inline variant — renders Combobox Input + Listbox without a Trigger/Portal.
 * Designed to live inside another popover (e.g. DropdownMenu.SubContent).
 * Stops arrow/enter/character keys from bubbling so the outer menu's
 * keyboard handler doesn't fight Kobalte's built-in combobox navigation.
 */
export const SearchableMultiSelectInline = (
  props: SearchableMultiSelectInlineProps
) => {
  const selectionIntent = createMultiSelectIntent();
  const [searchQuery, setSearchQuery] = createSignal('');
  let resetScroll: (() => void) | undefined;
  const committedWindow = createMemo(() => props.source?.windowKey());
  let previousWindow: string | undefined;
  createEffect(
    on(committedWindow, (window) => {
      if (window === undefined) return;
      if (previousWindow !== undefined && previousWindow !== window)
        resetScroll?.();
      previousWindow = window;
    })
  );

  const activeOptions = useActiveOptions(props.options, props.activeIds);
  const localHasMatches = useHasMatches(props.options, searchQuery);
  const visibleIds = createMemo(
    () => new Set(props.source?.visibleIds() ?? [])
  );
  const hasAction = () => props.source?.hasNext() || props.source?.error();
  const hasMatches = () =>
    props.source ? visibleIds().size > 0 || hasAction() : localHasMatches();
  const onInputChange = (value: string) => {
    setSearchQuery(value);
    props.source?.setSearch(value);
  };
  // Inline variant is freshly mounted each time the parent submenu opens,
  // so we don't need an explicit "menu opened" trigger — the memo's first
  // run captures the current selection ordering.
  const selectedFirstOptions = useSelectedFirst({
    items: props.options,
    selectedIds: props.activeIds,
    searchQuery,
    getId: getOptionId,
  });
  const sortedOptions = () =>
    props.source || props.preserveOrder
      ? props.options()
      : selectedFirstOptions();

  const displayOptions = createMemo(() =>
    hasAction()
      ? [
          ...sortedOptions(),
          {
            id: ACTION_ID,
            label: props.source?.error()
              ? t('viewMenus.retryOptions')
              : t('viewMenus.nextOptions'),
            disabled: props.source?.loading(),
          },
        ]
      : sortedOptions()
  );

  const handleChange = (selected: SearchableOption[]) => {
    if (props.source && selected.some((option) => option.id === ACTION_ID)) {
      if (props.source.error())
        fireAndForget(props.source.retry(), 'filter-options');
      else props.source.next();
      return;
    }
    const id =
      selected.find((option) => !props.activeIds().includes(option.id))?.id ??
      activeOptions().find(
        (option) => !selected.some((next) => next.id === option.id)
      )?.id;
    if (id !== undefined)
      props.onChange(
        applyMultiSelectSelection(
          props.activeIds(),
          id,
          selectionIntent.intent()
        )
      );
    if (selectionIntent.shouldClose())
      queueMicrotask(() => props.onSelectionComplete?.());
  };

  const handleInputKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft': {
        const input = e.currentTarget as HTMLInputElement;
        // At the start of the input (no caret movement possible), collapse
        // back to the parent menu. Otherwise let the input move the caret.
        if (input.selectionStart === 0 && input.selectionEnd === 0) {
          props.onRequestClose?.();
          return;
        }
        e.stopPropagation();
        return;
      }
      case 'Escape':
        // Let parent close
        return;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case 'Home':
      case 'End':
      case 'PageUp':
      case 'PageDown':
        e.stopPropagation();
        return;
      default:
        // Character keys, backspace, etc. — Combobox.Input handles them;
        // stop bubbling so the outer menu doesn't run typeahead.
        e.stopPropagation();
    }
  };

  return (
    <Combobox<SearchableOption>
      multiple
      selectionBehavior="toggle"
      closeOnSelection={false}
      open
      options={displayOptions()}
      defaultFilter={
        props.source
          ? (option) => option.id === ACTION_ID || visibleIds().has(option.id)
          : undefined
      }
      value={activeOptions()}
      onChange={handleChange}
      onInputChange={onInputChange}
      optionValue="id"
      optionTextValue="label"
      optionLabel="label"
      optionDisabled="disabled"
      allowsEmptyCollection
      virtualized
      removeOnBackspace={false}
    >
      <div
        ref={selectionIntent.track}
        class="flex items-center gap-2 px-3 py-2 border-b border-edge-muted"
      >
        <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
        <PickerSearchInput
          onReady={(element) => {
            props.inputRef?.(element);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={props.placeholder}
        />
      </div>
      <div ref={selectionIntent.track} class="p-1">
        <Show when={props.source}>
          {(source) => <SearchableSourceStatus source={source()} />}
        </Show>
        <Show
          when={hasMatches()}
          fallback={
            <div class="py-3 px-2 text-center text-xs text-ink-muted">
              <Show when={!props.source}>
                No options match "{searchQuery()}"
              </Show>
            </div>
          }
        >
          <VirtualizedListbox
            resetScrollRef={(reset) => {
              resetScroll = reset;
            }}
            class={props.listboxClass}
            selectionIntent={selectionIntent}
            onOnly={(id) => props.onChange([id])}
          />
        </Show>
      </div>
      {props.footer}
    </Combobox>
  );
};
