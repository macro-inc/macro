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
  MAX_RECOMMENDED_MODELS,
  type ModelFamily,
  matchesModelQuery,
  modelFamilyHint,
  moreModelFamilies,
} from './modelCatalog';

type ModelCatalogPickerProps = {
  value: string | null;
  /** Model to feature first without marking it selected. */
  recommendedId?: string | null;
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

/** The remaining families, grouped, for the More models screen. */
function FamilyList(props: {
  families: ModelFamily[];
  value: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
  row: Component<ModelRowProps>;
  onClose?: () => void;
}) {
  const Row = props.row;
  return (
    <For each={props.families}>
      {(family) => (
        <>
          <Show when={family.label}>
            <Dropdown.GroupLabel>{family.label}</Dropdown.GroupLabel>
          </Show>
          <For each={family.options}>
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
        </>
      )}
    </For>
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
 * Hover-opened subs never move focus into the catalog, click-opened pickers
 * lose the caret to Kobalte's selected row, and two later races would steal
 * it even after we focus search:
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
          recommendedId={props.recommendedId}
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
          autoFocusSearch
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
    | 'recommendedId'
    | 'options'
    | 'onSelect'
    | 'disabled'
    | 'emptyMessage'
    | 'searchPlaceholder'
    | 'children'
  > & {
    searchRef?: (element: HTMLInputElement) => void;
    /**
     * Focus search when this catalog mounts — click-opened pickers and
     * hover-opened agent submenus, which never fire (or lose) the root
     * menu's `onOpenAutoFocus`.
     */
    autoFocusSearch?: boolean;
    onClose?: () => void;
  }
) {
  let searchEl: HTMLInputElement | undefined;
  const Row = props.modelRow ?? ModelRow;
  const [query, setQuery] = createSignal('');
  onMount(() => {
    if (props.autoFocusSearch) keepSearchFocused(() => searchEl);
  });
  // A submenu needs a second menu's width beside the first, which a phone
  // does not have: there, More models replaces the list in place instead.
  const [showingMore, setShowingMore] = createSignal(false);
  const normalizedQuery = () => query().trim().toLowerCase();
  const filtered = createMemo(() => {
    const currentQuery = normalizedQuery();
    if (!currentQuery) return [];
    return props.options.filter((option) =>
      matchesModelQuery(option, currentQuery)
    );
  });
  const catalog = createMemo(() =>
    props.options.length <= MAX_RECOMMENDED_MODELS
      ? { recommended: props.options, families: [] }
      : buildModelCatalog(
          props.options,
          props.value ?? props.recommendedId ?? undefined
        )
  );
  const extraFamilies = createMemo(() => moreModelFamilies(catalog()));
  const extraCount = createMemo(() =>
    extraFamilies().reduce((count, family) => count + family.options.length, 0)
  );

  return (
    <>
      <div class="bg-menu p-1.5">
        <div class="flex items-center gap-2 px-2">
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
            class="min-w-0 w-full border-0 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-extra-muted"
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
          <Show
            when={!(isMobileWidth() && showingMore())}
            fallback={
              <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
                <Dropdown.Item
                  closeOnSelect={false}
                  class="h-8 gap-2 text-ink-muted"
                  onSelect={() => setShowingMore(false)}
                >
                  <CaretRight class="size-3 shrink-0 rotate-180" />
                  <span class="min-w-0 flex-1 truncate text-sm">
                    Recommended
                  </span>
                </Dropdown.Item>
                <FamilyList
                  families={extraFamilies()}
                  value={props.value}
                  disabled={props.disabled}
                  onSelect={props.onSelect}
                  row={Row}
                  onClose={props.onClose}
                />
              </Dropdown.Group>
            }
          >
            <Show when={catalog().recommended.length > 0}>
              <Dropdown.Group>
                <Dropdown.GroupLabel>Recommended</Dropdown.GroupLabel>
                <For each={catalog().recommended}>
                  {(option) => (
                    <Row
                      option={option}
                      onClose={props.onClose}
                      hint={modelFamilyHint(option)}
                      selected={option.id === props.value}
                      disabled={props.disabled}
                      onSelect={() => props.onSelect(option.id)}
                    />
                  )}
                </For>
              </Dropdown.Group>
            </Show>

            <Show when={extraCount() > 0}>
              <Dropdown.Group>
                <Show
                  when={!isMobileWidth()}
                  fallback={
                    <Dropdown.Item
                      closeOnSelect={false}
                      class="justify-between"
                      onSelect={() => setShowingMore(true)}
                    >
                      <span class="truncate">More models</span>
                      <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted">
                        {extraCount()}
                        <CaretRight class="size-3" />
                      </span>
                    </Dropdown.Item>
                  }
                >
                  <Dropdown.Sub overlap>
                    <Dropdown.SubTrigger>
                      <span class="truncate">More models</span>
                      <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted">
                        {extraCount()}
                        <CaretRight class="size-3" />
                      </span>
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent
                      onPointerDown={(event: PointerEvent) =>
                        event.stopPropagation()
                      }
                      onMouseDown={(event: MouseEvent) =>
                        event.stopPropagation()
                      }
                      class="w-72 max-w-[calc(100vw-1rem)] max-h-[var(--kb-popper-content-available-height)] overflow-y-auto overscroll-contain"
                    >
                      <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
                        <FamilyList
                          families={extraFamilies()}
                          value={props.value}
                          disabled={props.disabled}
                          onSelect={props.onSelect}
                          row={Row}
                          onClose={props.onClose}
                        />
                      </Dropdown.Group>
                    </Dropdown.SubContent>
                  </Dropdown.Sub>
                </Show>
              </Dropdown.Group>
            </Show>
          </Show>
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
                hint={modelFamilyHint(option)}
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
