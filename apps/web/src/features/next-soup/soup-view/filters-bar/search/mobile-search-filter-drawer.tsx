import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Accordion } from '@kobalte/core/accordion';
import ChevronDownIcon from '@phosphor/caret-down.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { cn } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { type SearchFacetVM, useSearchFacets } from './search-facets';
import { createSearchFiltersController } from './search-filters-state';

/** Threshold above which a multi facet's option list gets its own search. */
const SEARCHABLE_OPTION_COUNT = 8;

type MultiFacet = Extract<SearchFacetVM, { kind: 'multi' }>;
type SingleFacet = Extract<SearchFacetVM, { kind: 'single' }>;

function SingleFacetContent(props: { facet: SingleFacet }) {
  return (
    <For each={props.facet.options}>
      {(option) => {
        const active = () => props.facet.selectedId() === option.id;
        return (
          <MobileFilterDrawer.Option
            selectionMode="single"
            checked={active()}
            onChange={() => props.facet.onSelect(option.id)}
            icon={option.icon?.()}
          >
            {option.label}
          </MobileFilterDrawer.Option>
        );
      }}
    </For>
  );
}

function MultiFacetContent(props: { facet: MultiFacet }) {
  const [query, setQuery] = createSignal('');

  const filteredOptions = createMemo(() => {
    const q = query().toLowerCase();
    const options = props.facet.options();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  });

  const toggle = (id: string) => {
    const current = props.facet.activeIds();
    props.facet.onChange(
      current.includes(id)
        ? current.filter((activeId) => activeId !== id)
        : [...current, id]
    );
  };

  return (
    <>
      {/* Any-of/all-of segment (e.g. tags), mirroring the desktop chip. */}
      <Show when={props.facet.mode?.visible()}>
        <div
          class="flex gap-1 rounded-[20px] bg-ink/5 p-1 mb-1"
          role="radiogroup"
          aria-label="Match"
        >
          <For
            each={[
              { id: 'any', label: 'Match any' } as const,
              { id: 'all', label: 'Match all' } as const,
            ]}
          >
            {(option) => {
              const active = () => props.facet.mode?.value() === option.id;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={active()}
                  class={cn(
                    'min-h-10 flex-1 rounded-2xl px-3 py-2 text-sm transition-colors hover:bg-ink/6 aria-checked:bg-ink/8',
                    active() ? 'text-accent font-medium' : 'text-ink-muted'
                  )}
                  onClick={() => props.facet.mode?.onSelect(option.id)}
                >
                  {option.label}
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={props.facet.options().length > SEARCHABLE_OPTION_COUNT}>
        <div class="flex min-h-11 items-center gap-2 rounded-[20px] px-3 py-2 bg-ink/5 mb-1">
          <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
          <input
            type="text"
            aria-label={props.facet.placeholder}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={props.facet.placeholder}
            class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-placeholder"
          />
        </div>
      </Show>

      <div class="max-h-[calc(50*var(--dvh))] overflow-y-auto scrollbar-hidden">
        <For each={filteredOptions()}>
          {(option) => {
            const active = () => props.facet.activeIds().includes(option.id);
            const isSole = () => {
              const ids = props.facet.activeIds();
              return ids.length === 1 && ids[0] === option.id;
            };
            return (
              <div class="w-full flex items-stretch gap-1">
                <MobileFilterDrawer.Option
                  class="min-w-0 flex-1"
                  checked={active()}
                  onChange={() => toggle(option.id)}
                  icon={option.icon?.()}
                >
                  {option.label}
                </MobileFilterDrawer.Option>
                <Show
                  when={props.facet.onOnly && props.facet.options().length > 1}
                >
                  <button
                    type="button"
                    class="shrink-0 rounded-xl px-3 text-xs text-ink-muted hover:text-ink hover:bg-ink/6 transition-colors"
                    aria-label={
                      isSole()
                        ? `Show all ${props.facet.label.toLowerCase()}`
                        : `Show only ${option.label}`
                    }
                    onClick={() => props.facet.onOnly?.(option.id)}
                  >
                    {isSole() ? 'All' : 'Only'}
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
        <Show when={filteredOptions().length === 0}>
          <div class="px-4 py-2 text-sm text-ink-muted">No results</div>
        </Show>
      </div>
    </>
  );
}

function FacetSection(props: { facet: SearchFacetVM }) {
  return (
    <MobileDrawer.Section
      as={Accordion.Item}
      value={props.facet.id}
      class="mb-3"
    >
      <Accordion.Header>
        <Accordion.Trigger
          as={MobileDrawer.Item}
          class="group justify-between font-medium data-expanded:bg-ink/5"
        >
          <span class="font-medium">{props.facet.label}</span>
          <div class="flex items-center gap-2">
            <Show when={!props.facet.isDefault()}>
              <Switch>
                <Match when={props.facet.kind === 'multi' && props.facet}>
                  {(facet) => (
                    <span class="group-data-expanded:hidden size-4 flex items-center justify-center rounded-full bg-accent text-surface text-xxs font-medium leading-none">
                      {facet().activeIds().length}
                    </span>
                  )}
                </Match>
                <Match when={props.facet.kind === 'single'}>
                  <span class="group-data-expanded:hidden text-xs text-accent truncate max-w-32">
                    {props.facet.values()[0]?.label}
                  </span>
                </Match>
              </Switch>
            </Show>
            <ChevronDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-expanded:rotate-180" />
          </div>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content class="pt-1">
        <Switch>
          <Match when={props.facet.kind === 'single' && props.facet}>
            {(facet) => <SingleFacetContent facet={facet()} />}
          </Match>
          <Match when={props.facet.kind === 'multi' && props.facet}>
            {(facet) => <MultiFacetContent facet={facet()} />}
          </Match>
        </Switch>
      </Accordion.Content>
    </MobileDrawer.Section>
  );
}

/**
 * Mobile counterpart of the desktop Search view's facet chips
 * (SearchFiltersRow): the same facets — the Type scope plus the active
 * type's refinements (inbox, in/from, status, priority, assignee, tags…) —
 * presented as a bottom drawer opened from the search view's header filter
 * button. Facet semantics live in search-facets / search-filters-state; this
 * file is presentation only.
 */
export const MobileSearchFilterDrawer = (props: { class?: string }) => {
  const controller = createSearchFiltersController();
  const facets = useSearchFacets(controller);

  const activeCount = createMemo(
    () => facets().filter((facet) => !facet.isDefault()).length
  );
  const resetAll = () => {
    for (const facet of facets()) facet.reset();
  };

  return (
    <MobileFilterDrawer
      class={props.class}
      triggerLabel="Open search filters"
      label="Search filters"
      activeCount={activeCount()}
      onClear={resetAll}
    >
      <Accordion multiple collapsible defaultValue={['type']}>
        <For each={facets()}>{(facet) => <FacetSection facet={facet} />}</For>
      </Accordion>
    </MobileFilterDrawer>
  );
};
