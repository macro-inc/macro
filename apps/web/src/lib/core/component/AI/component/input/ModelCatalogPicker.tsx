import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import CaretDown from '@icon/system/regular/caret-left.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import SquaresFour from '@icon/system/regular/squares-four.svg';
import { Button, type ButtonSize, cn, Dropdown } from '@ui';
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
  /** Called instead of `onSelect` for a `locked` option, e.g. to open the paywall. */
  onLocked?: (id: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  modelRow?: Component<ModelRowProps>;
  disabled?: boolean;
  /** Show only the selected model's logo in the trigger. */
  compact?: boolean;
  pending?: boolean;
  triggerLabel?: JSX.Element;
  children?: JSX.Element;
  emptyMessage?: string;
  triggerClass?: string;
  triggerSize?: ButtonSize;
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
      class={cn(
        'h-8 gap-2',
        props.selected && 'bg-ink/5 text-ink font-medium',
        props.option.locked && 'opacity-50'
      )}
      title={props.option.description ?? props.option.label}
      aria-label={
        props.option.locked
          ? `${props.option.label}, upgrade required`
          : undefined
      }
      onSelect={props.onSelect}
    >
      <ModelIcon model={props.option.id} />
      <span class="min-w-0 flex-1 truncate text-sm">{props.option.label}</span>
      <Show when={props.hint}>
        <span class="shrink-0 text-xs text-ink-extra-muted">{props.hint}</span>
      </Show>
      <Show when={props.option.locked}>
        <LockIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
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
    <Dropdown.Group class="py-0">
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
      event.target.closest('[role="menuitem"], input[type="range"]')
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

/**
 * The one model selector: a searchable popover on desktop and a bottom sheet
 * on touch devices, with Suggested first and the complete catalog behind
 * More models. Composers, sessions, and settings all render this.
 */
export function ModelCatalogPicker(props: ModelCatalogPickerProps) {
  const [open, setOpen] = createSignal(false);
  let searchRef: HTMLInputElement | undefined;

  const selected = () =>
    props.options.find((option) => option.id === props.value) ?? null;
  const displayValue = () => selected()?.label ?? props.placeholder ?? 'Model';
  const title = () =>
    typeof props.triggerLabel === 'string'
      ? props.triggerLabel
      : displayValue();
  const choose = (id: string) => {
    setOpen(false);
    if (props.options.find((option) => option.id === id)?.locked)
      props.onLocked?.(id);
    else props.onSelect(id);
  };
  const triggerContents = () => (
    <>
      <ModelIcon model={props.value} />
      <Show when={!props.compact}>
        <span class="min-w-0 flex-1 truncate text-left">
          {props.triggerLabel ?? displayValue()}
        </span>
        <CaretDown class="size-3.5 shrink-0 rotate-[-90deg] opacity-70" />
      </Show>
    </>
  );
  const triggerClass = () =>
    cn(
      'justify-between border border-edge-muted bg-transparent px-3 text-left text-sm text-ink hover:bg-ink/3',
      props.triggerSize === undefined && 'h-9',
      props.triggerClass
    );

  return (
    <Show
      when={!isTouchDevice()}
      fallback={
        <ModelCatalogSheet
          {...props}
          open={open()}
          onOpenChange={setOpen}
          onChoose={choose}
          trigger={triggerContents()}
          triggerClass={triggerClass()}
          title={title()}
        />
      }
    >
      <Dropdown
        open={open()}
        onOpenChange={setOpen}
        placement={props.placement ?? 'top-start'}
      >
        <Dropdown.Trigger
          variant="ghost"
          size={props.triggerSize ?? 'sm'}
          class={triggerClass()}
          aria-label={props.ariaLabel}
          aria-busy={props.pending || undefined}
          title={title()}
          disabled={props.disabled || props.pending}
        >
          {triggerContents()}
        </Dropdown.Trigger>
        <Dropdown.Content
          onCloseAutoFocus={props.onCloseAutoFocus}
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
            onSelect={choose}
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
    </Show>
  );
}

/** Touch devices: the same catalog as a searchable bottom sheet. */
function ModelCatalogSheet(
  props: ModelCatalogPickerProps & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onChoose: (id: string) => void;
    trigger: JSX.Element;
    triggerClass: string;
    title: string;
  }
) {
  const [query, setQuery] = createSignal('');
  const [showAll, setShowAll] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  let searchInput: HTMLInputElement | undefined;
  const catalog = createMemo(() => buildModelCatalog(props.options, true));
  const groups = createMemo(() => {
    const queryText = query().trim().toLowerCase();
    const sections =
      showAll() || queryText || catalog().frontier.length === 0
        ? catalog().providers
        : [{ label: 'Suggested', options: catalog().frontier }];
    return sections
      .map((section) => ({
        ...section,
        options: section.options.filter((option) =>
          matchesModelQuery(option, queryText)
        ),
      }))
      .filter((section) => section.options.length > 0);
  });
  const changeOpen = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) {
      setQuery('');
      setShowAll(false);
    }
  };

  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={changeOpen}
      restoreFocus={!!props.onCloseAutoFocus}
      onFinalFocus={props.onCloseAutoFocus}
      onInitialFocus={(event) => {
        event.preventDefault();
        searchInput?.focus();
      }}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Trigger
        ref={setTrigger}
        as={Button}
        variant="ghost"
        size={props.triggerSize ?? 'sm'}
        aria-label={props.ariaLabel}
        aria-busy={props.pending || undefined}
        title={props.title}
        disabled={props.disabled || props.pending}
        // Keep the editor focused (and the keyboard up) until the tap lands.
        onPointerDown={(event: PointerEvent) => event.preventDefault()}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
        class={props.triggerClass}
      >
        {props.trigger}
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal
        mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
      >
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label="Choose a model"
          on:keydown={(event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing) return;
            // Corvu and Kobalte have separate dismissal stacks. Consume the
            // sheet's Escape before it can dismiss a surrounding dialog.
            event.preventDefault();
            event.stopPropagation();
            changeOpen(false);
          }}
        >
          <MobileDrawer.Handle />
          <div class="flex items-center gap-2 px-4 pb-3">
            <Show when={showAll()}>
              <Button
                variant="ghost"
                size="icon-md"
                aria-label="Back to Suggested"
                tooltip="Back to Suggested"
                onClick={() => {
                  setShowAll(false);
                  setQuery('');
                  searchInput?.focus();
                }}
              >
                <ArrowLeft class="size-4 shrink-0 touch:size-6" />
              </Button>
            </Show>
            <MobileDrawer.Title class="min-w-0 flex-1 truncate font-medium">
              {showAll() ? 'All models' : 'Choose a model'}
            </MobileDrawer.Title>
          </div>
          <div class="mx-4 mb-2 flex h-9 shrink-0 items-center gap-2 px-3">
            <MagnifyingGlassIcon class="size-4 shrink-0 text-ink-extra-muted" />
            <input
              ref={searchInput}
              type="text"
              aria-label={props.searchPlaceholder ?? 'Search models'}
              placeholder={props.searchPlaceholder ?? 'Search models'}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              class="h-full min-w-0 w-full border-0 bg-transparent p-0 text-base outline-none placeholder:text-ink-extra-muted"
            />
          </div>
          <MobileDrawer.ScrollBody class="gap-1">
            <Show when={groups().length === 0}>
              <div role="status" class="px-4 py-3 text-sm text-ink-muted">
                {props.options.length === 0
                  ? (props.emptyMessage ?? 'No models available.')
                  : 'No models match that search.'}
              </div>
            </Show>
            <For each={groups()}>
              {(group) => (
                <>
                  <MobileDrawer.Label class="px-4 pb-1 font-medium text-ink-muted">
                    {group.label}
                  </MobileDrawer.Label>
                  <MobileDrawer.Section
                    role="radiogroup"
                    aria-label={group.label}
                    class="rounded-none bg-transparent p-0"
                  >
                    <For each={group.options}>
                      {(option) => (
                        <MobileDrawer.Item
                          type="button"
                          role="radio"
                          aria-checked={option.id === props.value}
                          aria-label={
                            option.locked
                              ? `${option.label}, upgrade required`
                              : undefined
                          }
                          aria-disabled={props.disabled || undefined}
                          title={option.description}
                          class={cn(option.locked && 'opacity-50')}
                          onClick={() => {
                            if (!props.disabled) props.onChoose(option.id);
                          }}
                        >
                          <ModelIcon model={option.id} />
                          <span class="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                          <Show when={option.locked}>
                            <LockIcon class="size-3.5 shrink-0 text-ink-muted" />
                          </Show>
                          <Show when={option.id === props.value}>
                            <CheckIcon class="size-3.5 shrink-0 text-accent" />
                          </Show>
                        </MobileDrawer.Item>
                      )}
                    </For>
                  </MobileDrawer.Section>
                </>
              )}
            </For>
            <Show
              when={
                !showAll() && !query().trim() && catalog().frontier.length > 0
              }
            >
              <MobileDrawer.Section class="rounded-none bg-transparent p-0">
                <MobileDrawer.Item
                  onClick={() => {
                    setShowAll(true);
                    searchInput?.focus();
                  }}
                >
                  <SquaresFour class="size-4 shrink-0 text-ink-muted" />
                  <span class="flex-1">More models</span>
                  <CaretRight class="size-4" />
                </MobileDrawer.Item>
              </MobileDrawer.Section>
            </Show>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
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
      {/* A transparent edge keeps the menu's bevel visible above the fill. */}
      <div class="sticky top-0 z-10 border-x border-t border-transparent bg-menu bg-clip-padding py-1">
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
        <div class="px-3 py-2 text-xs text-ink-muted" role="status">
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
                <div class="px-1.5 pb-1">
                  <Show
                    when={isMobileWidth()}
                    fallback={
                      <Dropdown.Sub>
                        <Dropdown.SubTrigger class="h-8 gap-2">
                          <SquaresFour class="size-4 shrink-0 text-ink-muted" />
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
                      class="h-8 gap-2"
                      closeOnSelect={false}
                      onSelect={() => {
                        setShowAll(true);
                        searchEl?.focus();
                      }}
                    >
                      <SquaresFour class="size-4 shrink-0 text-ink-muted" />
                      <span class="flex-1">More models</span>
                      <CaretRight class="size-3.5" />
                    </Dropdown.Item>
                  </Show>
                </div>
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
