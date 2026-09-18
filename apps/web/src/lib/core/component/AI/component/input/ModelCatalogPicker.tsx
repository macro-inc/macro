import CaretDown from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { cn, Dropdown } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { modelProvider, ProviderIcon } from '../ProviderIcon';
import {
  buildModelCatalog,
  type CatalogModelOption,
  MAX_RECOMMENDED_MODELS,
  matchesModelQuery,
  modelFamilyHint,
  moreModelFamilies,
} from './modelCatalog';

type ModelCatalogPickerProps = {
  value: string | null;
  options: CatalogModelOption[];
  onSelect: (id: string) => void;
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

function ModelIcon(props: { model?: string | null }) {
  return (
    <Show
      when={modelProvider(props.model)}
      fallback={<SparkleIcon class="size-4 shrink-0" />}
    >
      <ProviderIcon model={props.model} class="size-4" />
    </Show>
  );
}

function ModelRow(props: {
  option: CatalogModelOption;
  selected: boolean;
  /** Trailing muted text, e.g. the family a search hit belongs to. */
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item
      closeOnSelect
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

export function ModelCatalogPicker(props: ModelCatalogPickerProps) {
  let searchRef: HTMLInputElement | undefined;

  const selected = () =>
    props.options.find((option) => option.id === props.value) ?? null;
  const displayValue = () => selected()?.label ?? props.placeholder ?? 'Model';

  return (
    <Dropdown placement={props.placement ?? 'top-start'}>
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        class={cn(
          'h-9 justify-between rounded-lg border border-edge-muted bg-transparent px-3 text-left text-sm text-ink hover:bg-ink/3',
          props.triggerClass
        )}
        aria-label={props.ariaLabel}
        aria-busy={props.pending || undefined}
        title={displayValue()}
        disabled={props.disabled || props.pending}
      >
        <ModelIcon model={props.value} />
        <span class="min-w-0 truncate">
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
          onSelect={props.onSelect}
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
    | 'value'
    | 'options'
    | 'onSelect'
    | 'emptyMessage'
    | 'searchPlaceholder'
    | 'children'
  > & {
    searchRef?: (element: HTMLInputElement) => void;
  }
) {
  const [query, setQuery] = createSignal('');
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
      : buildModelCatalog(props.options, props.value ?? undefined)
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
            ref={props.searchRef}
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
          <>
            <Show when={catalog().recommended.length > 0}>
              <Dropdown.Group>
                <Dropdown.GroupLabel>Recommended</Dropdown.GroupLabel>
                <For each={catalog().recommended}>
                  {(option) => (
                    <ModelRow
                      option={option}
                      hint={modelFamilyHint(option)}
                      selected={option.id === props.value}
                      onSelect={() => props.onSelect(option.id)}
                    />
                  )}
                </For>
              </Dropdown.Group>
            </Show>

            <Show when={extraCount() > 0}>
              <Dropdown.Group>
                <Dropdown.Sub>
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
                    onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                    class="w-72 max-w-[calc(100vw-1rem)] max-h-[var(--kb-popper-content-available-height)] overflow-y-auto overscroll-contain"
                  >
                    <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
                      <For each={extraFamilies()}>
                        {(family) => (
                          <>
                            <Show when={family.label}>
                              <Dropdown.GroupLabel>
                                {family.label}
                              </Dropdown.GroupLabel>
                            </Show>
                            <For each={family.options}>
                              {(option) => (
                                <ModelRow
                                  option={option}
                                  selected={option.id === props.value}
                                  onSelect={() => props.onSelect(option.id)}
                                />
                              )}
                            </For>
                          </>
                        )}
                      </For>
                    </Dropdown.Group>
                  </Dropdown.SubContent>
                </Dropdown.Sub>
              </Dropdown.Group>
            </Show>
          </>
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
              <ModelRow
                option={option}
                hint={modelFamilyHint(option)}
                selected={option.id === props.value}
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
