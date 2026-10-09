import { isMobileWidth } from '@core/mobile/mobileWidth';
import CaretDown from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { cn, Dropdown } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { ModelIcon } from '../ProviderIcon';
import {
  buildModelCatalog,
  type CatalogModelOption,
  matchesModelQuery,
  modelProviderLabel,
} from './modelCatalog';

type ModelCatalogPickerProps = {
  value: string | null;
  options: CatalogModelOption[];
  onSelect: (id: string) => void;
  modelRow?: Component<ModelRowProps>;
  disabled?: boolean;
  pending?: boolean;
  triggerLabel?: JSX.Element;
  children?: JSX.Element;
  emptyMessage?: string;
  triggerClass?: string;
  contentClass?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
  placement?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
};

export type ModelRowProps = {
  option: CatalogModelOption;
  selected: boolean;
  disabled?: boolean;
  /** Trailing muted text, e.g. the family a search hit belongs to. */
  hint?: string;
  onSelect: () => void;
  onClose?: () => void;
};

export function ModelRow(props: ModelRowProps) {
  return (
    <Dropdown.Item
      closeOnSelect
      disabled={props.disabled}
      class={cn('h-8 gap-2', props.selected && 'bg-ink/5 text-ink font-medium')}
      title={props.option.description ?? props.option.label}
      onSelect={props.onSelect}
    >
      <ModelIcon model={props.option.id} />
      <span class="min-w-0 flex-1 truncate text-sm">{props.option.label}</span>
      <Show when={props.hint}>
        <span class="shrink-0 text-xs text-ink-extra-muted">{props.hint}</span>
      </Show>
      <Show when={props.selected}>
        <CheckIcon class="size-3.5 shrink-0 text-accent" />
      </Show>
    </Dropdown.Item>
  );
}

/** One model section, shared by the frontier shortlist and provider groups. */
function ModelList(props: {
  label: string;
  options: CatalogModelOption[];
  value: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
  row: Component<ModelRowProps>;
  onClose?: () => void;
}) {
  const Row = props.row;
  return (
    <Dropdown.Group class="bg-transparent py-0">
      <Dropdown.GroupLabel class="h-6 font-medium text-ink-muted">
        {props.label}
      </Dropdown.GroupLabel>
      <For each={props.options}>
        {(option) => (
          <Row
            option={option}
            onClose={props.onClose}
            selected={option.id === props.value}
            disabled={props.disabled}
            onSelect={() => props.onSelect(option.id)}
          />
        )}
      </For>
    </Dropdown.Group>
  );
}

/**
 * Kobalte menus still autofocus the collection on a deferred `setTimeout(0)`
 * (`deferAutoFocus` in createSelectableList) after `onOpenAutoFocus` is
 * prevented. A microtask loses that race; wait past the timeout so typing
 * lands in search.
 */
function focusSearchAfterMenuOpen(input: () => HTMLInputElement | undefined) {
  setTimeout(() => {
    requestAnimationFrame(() => {
      const search = input();
      if (search?.isConnected) search.focus();
    });
  });
}

/**
 * Hover-opened subs never move focus into the catalog, and two later races
 * would steal the caret even after we do:
 *   1. Focusing before the portaled DismissableLayer registers looks like
 *      "focus outside" to the parent and closes the menu tree. The timeout
 *      + rAF in `focusSearchAfterMenuOpen` waits past that onMount.
 *   2. SubTrigger `onPointerMove` keeps calling `focusWithoutScrolling` on
 *      the agent row, so any mouse move while hovering it yanks focus back.
 *      Keep startup autofocus on search, then reclaim only when that parent
 *      trigger steals focus. Model rows and their nested effort menus must
 *      retain focus once the user navigates them.
 */
function keepSearchFocused(input: () => HTMLInputElement | undefined) {
  focusSearchAfterMenuOpen(input);
  const menu = input()?.closest('[role="menu"]');
  let navigating = false;
  const onNavigate = (event: Event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('[role="menuitem"]')
    ) {
      navigating = true;
    }
  };
  for (const type of ['pointermove', 'pointerdown', 'keydown']) {
    menu?.addEventListener(type, onNavigate, true);
  }
  const onBlur = () => {
    queueMicrotask(() => {
      const search = input();
      const triggerId = menu?.getAttribute('aria-labelledby');
      const active = document.activeElement;
      // Kobalte may focus its selected row after the search's initial focus.
      // Once the user navigates the catalog, leave those rows in control.
      const initialRowFocus =
        !navigating && menu && active?.closest('[role="menu"]') === menu;
      if (
        search?.isConnected &&
        (triggerId === active?.id || initialRowFocus)
      ) {
        search.focus();
      }
    });
  };
  input()?.addEventListener('blur', onBlur);
  onCleanup(() => {
    input()?.removeEventListener('blur', onBlur);
    for (const type of ['pointermove', 'pointerdown', 'keydown']) {
      menu?.removeEventListener(type, onNavigate, true);
    }
  });
}

export function ModelCatalogPicker(props: ModelCatalogPickerProps) {
  const [open, setOpen] = createSignal(false);
  let searchRef: HTMLInputElement | undefined;

  const selected = () =>
    props.options.find((option) => option.id === props.value) ?? null;
  const displayValue = () => selected()?.label ?? props.placeholder ?? 'Model';

  return (
    <Dropdown
      open={open()}
      onOpenChange={setOpen}
      placement={props.placement ?? 'top-start'}
    >
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        class={cn(
          'h-9 justify-between border border-edge-muted bg-transparent px-3 text-left text-sm text-ink hover:bg-ink/3',
          props.triggerClass
        )}
        aria-label={props.ariaLabel}
        aria-busy={props.pending || undefined}
        title={
          typeof props.triggerLabel === 'string'
            ? props.triggerLabel
            : displayValue()
        }
        disabled={props.disabled || props.pending}
      >
        <ModelIcon model={props.value} />
        <span class="min-w-0 flex-1 truncate text-left">
          {props.triggerLabel ?? displayValue()}
        </span>
        <CaretDown class="size-3.5 shrink-0 rotate-[-90deg] opacity-70" />
      </Dropdown.Trigger>
      <Dropdown.Content
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
        class={cn(
          'w-72 max-w-[calc(100vw-1rem)] max-h-[min(28rem,var(--kb-popper-content-available-height))] overflow-y-auto overscroll-contain',
          props.contentClass
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusSearchAfterMenuOpen(() => searchRef);
        }}
      >
        <ModelCatalogMenu
          value={props.value}
          options={props.options}
          disabled={props.disabled || props.pending}
          onSelect={(id) => {
            props.onSelect(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          modelRow={props.modelRow}
          emptyMessage={props.emptyMessage}
          searchPlaceholder={props.searchPlaceholder}
          searchRef={(element) => {
            searchRef = element;
          }}
        >
          {props.children}
        </ModelCatalogMenu>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** Shared searchable catalog, usable inside a root menu or an agent submenu. */
export function ModelCatalogMenu(
  props: Pick<
    ModelCatalogPickerProps,
    | 'modelRow'
    | 'value'
    | 'options'
    | 'onSelect'
    | 'disabled'
    | 'emptyMessage'
    | 'searchPlaceholder'
    | 'children'
  > & {
    searchRef?: (element: HTMLInputElement) => void;
    /**
     * Focus search when this catalog mounts, including root agent pickers
     * and hover-opened submenus without their own autofocus handler.
     */
    autoFocusSearch?: boolean;
    fullCatalog?: boolean;
    onClose?: () => void;
  }
) {
  let searchEl: HTMLInputElement | undefined;
  const Row = props.modelRow ?? ModelRow;
  const [query, setQuery] = createSignal('');
  const [showAll, setShowAll] = createSignal(false);
  onMount(() => {
    if (props.autoFocusSearch) keepSearchFocused(() => searchEl);
  });
  const normalizedQuery = () => query().trim().toLowerCase();
  const filtered = createMemo(() => {
    const currentQuery = normalizedQuery();
    if (!currentQuery) return [];
    return props.options.filter((option) =>
      matchesModelQuery(option, currentQuery)
    );
  });
  const catalog = createMemo(() => buildModelCatalog(props.options, true));

  return (
    <>
      <div class="sticky top-0 z-10 bg-menu py-1">
        <div class="flex h-8 items-center gap-2 px-3">
          <MagnifyingGlassIcon
            aria-hidden="true"
            class="size-4 shrink-0 text-ink-extra-muted"
          />
          <input
            ref={(element) => {
              searchEl = element;
              props.searchRef?.(element);
            }}
            aria-label={props.searchPlaceholder ?? 'Search models'}
            placeholder={props.searchPlaceholder ?? 'Search models'}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onMouseDown={(event: MouseEvent) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
            onKeyUp={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
            class="min-w-0 h-full w-full border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-ink-extra-muted"
          />
        </div>
      </div>

      {props.children}
      <Show when={props.options.length === 0}>
        <div class="bg-menu px-3 py-2 text-xs text-ink-muted" role="status">
          {props.emptyMessage ?? 'No models available.'}
        </div>
      </Show>
      <Show
        when={normalizedQuery().length > 0}
        fallback={
          <div class="space-y-1">
            <Show
              when={
                !props.fullCatalog &&
                !showAll() &&
                catalog().frontier.length > 0
              }
            >
              <ModelList
                label="Suggested"
                options={catalog().frontier}
                value={props.value}
                disabled={props.disabled}
                onSelect={props.onSelect}
                row={Row}
                onClose={props.onClose}
              />
            </Show>
            <Show
              when={
                props.fullCatalog ||
                showAll() ||
                catalog().frontier.length === 0
              }
              fallback={
                <Show
                  when={isMobileWidth()}
                  fallback={
                    <Dropdown.Sub>
                      <Dropdown.SubTrigger class="h-8 gap-2">
                        <span class="flex-1">More models</span>
                        <CaretRight class="size-3.5" />
                      </Dropdown.SubTrigger>
                      <Dropdown.SubContent
                        aria-label="All models"
                        class="w-72 max-w-[calc(100vw-1rem)] max-h-[min(28rem,var(--kb-popper-content-available-height))] overflow-y-auto overscroll-contain"
                        onOpenAutoFocus={(event: Event) =>
                          event.preventDefault()
                        }
                        onPointerDown={(event: PointerEvent) =>
                          event.stopPropagation()
                        }
                        onMouseDown={(event: MouseEvent) =>
                          event.stopPropagation()
                        }
                      >
                        <ModelCatalogMenu
                          fullCatalog
                          autoFocusSearch
                          value={props.value}
                          options={props.options}
                          disabled={props.disabled}
                          onSelect={props.onSelect}
                          modelRow={Row}
                          onClose={props.onClose}
                        />
                      </Dropdown.SubContent>
                    </Dropdown.Sub>
                  }
                >
                  <Dropdown.Item
                    closeOnSelect={false}
                    onSelect={() => {
                      setShowAll(true);
                      searchEl?.focus();
                    }}
                  >
                    <span class="flex-1">More models</span>
                    <CaretRight class="size-3.5" />
                  </Dropdown.Item>
                </Show>
              }
            >
              <Show when={showAll()}>
                <Dropdown.Item
                  closeOnSelect={false}
                  onSelect={() => {
                    setShowAll(false);
                    setQuery('');
                    searchEl?.focus();
                  }}
                >
                  Back to Suggested
                </Dropdown.Item>
              </Show>
              <For each={catalog().providers}>
                {(provider) => (
                  <ModelList
                    label={provider.label}
                    options={provider.options}
                    value={props.value}
                    disabled={props.disabled}
                    onSelect={props.onSelect}
                    row={Row}
                    onClose={props.onClose}
                  />
                )}
              </For>
            </Show>
          </div>
        }
      >
        <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
          <Dropdown.GroupLabel>
            {filtered().length === 1
              ? '1 matching model'
              : `${filtered().length} matching models`}
          </Dropdown.GroupLabel>
          <For each={filtered()}>
            {(option) => (
              <Row
                option={option}
                onClose={props.onClose}
                hint={modelProviderLabel(option)}
                selected={option.id === props.value}
                disabled={props.disabled}
                onSelect={() => props.onSelect(option.id)}
              />
            )}
          </For>
          <Show when={filtered().length === 0}>
            <div class="px-3 py-4 text-sm text-ink-muted">
              No models match that search.
            </div>
          </Show>
        </Dropdown.Group>
      </Show>
    </>
  );
}
