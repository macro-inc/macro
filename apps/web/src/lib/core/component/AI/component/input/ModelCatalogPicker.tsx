import CaretDown from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { cn, Dropdown } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  buildModelCatalog,
  type CatalogModelOption,
  matchesModelQuery,
  modelFamilyHint,
  moreModelFamilies,
} from './modelCatalog';

/**
 * Scrolling lists (search hits, More models) cap at roughly eight `h-8` rows
 * plus a label, so the popover never grows with the size of the catalog.
 */
const LIST_HEIGHT_CLASS = 'max-h-72 overflow-y-auto overscroll-contain';

type ModelCatalogPickerProps = {
  value: string | null;
  options: CatalogModelOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  triggerClass?: string;
  contentClass?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
  placement?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
};

function ModelRow(props: {
  option: CatalogModelOption;
  selected: boolean;
  /** Trailing muted text, e.g. the family a search hit belongs to. */
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item
      class={cn('h-8 gap-2', props.selected && 'bg-ink/5 text-ink font-medium')}
      title={props.option.description ?? undefined}
      onSelect={props.onSelect}
    >
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

export function ModelCatalogPicker(props: ModelCatalogPickerProps) {
  const [query, setQuery] = createSignal('');
  let searchRef: HTMLInputElement | undefined;

  const selected = () =>
    props.options.find((option) => option.id === props.value) ?? null;
  const displayValue = () => selected()?.label ?? props.placeholder ?? 'Model';

  const normalizedQuery = () => query().trim().toLowerCase();
  const filtered = createMemo(() => {
    const currentQuery = normalizedQuery();
    if (!currentQuery) return [];
    return props.options.filter((option) =>
      matchesModelQuery(option, currentQuery)
    );
  });
  const catalog = createMemo(() =>
    buildModelCatalog(props.options, props.value ?? undefined)
  );
  const extraFamilies = createMemo(() => moreModelFamilies(catalog()));
  const extraCount = createMemo(() =>
    extraFamilies().reduce((count, family) => count + family.options.length, 0)
  );

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
        disabled={props.disabled}
      >
        <span class="truncate">{displayValue()}</span>
        <CaretDown class="size-3.5 rotate-[-90deg] opacity-70" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class={cn(
          'w-72 max-w-[min(24rem,calc(100vw-1rem))]',
          props.contentClass
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          queueMicrotask(() => searchRef?.focus());
        }}
      >
        <div class="border-b border-edge-muted bg-menu p-1.5">
          <input
            ref={searchRef}
            aria-label={props.searchPlaceholder ?? 'Search models'}
            placeholder={props.searchPlaceholder ?? 'Search models'}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
            onKeyUp={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
            class="w-full rounded-lg border border-edge-muted bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-extra-muted focus:border-accent"
          />
        </div>

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
                <Dropdown.Separator class="h-px border-0 bg-edge-muted" />
                <Dropdown.Group>
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger>
                      <span class="truncate">More models</span>
                      <span class="flex shrink-0 items-center gap-1 text-xs text-ink-extra-muted">
                        {extraCount()}
                        <CaretRight class="size-3" />
                      </span>
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
                      <Dropdown.Group class={LIST_HEIGHT_CLASS}>
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
          <Dropdown.Group class={LIST_HEIGHT_CLASS}>
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
      </Dropdown.Content>
    </Dropdown>
  );
}
