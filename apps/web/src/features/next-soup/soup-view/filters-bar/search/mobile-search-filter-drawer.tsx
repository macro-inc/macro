import {
  MobileDrawer,
  scrollToFocusedInput,
} from '@components/app/mobile/MobileDrawer';
import { pressPulse } from '@components/app/mobile/pressPulse';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { Accordion } from '@kobalte/core/accordion';
import ChevronDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import SlidersHorizontalIcon from '@phosphor-icons/core/regular/sliders-horizontal.svg?component-solid';
import { Button, cn } from '@ui';
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
          <button
            type="button"
            role="radio"
            aria-checked={active()}
            class="w-full bg-surface flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-hover transition-colors text-left not-last:mb-px"
            onClick={() => props.facet.onSelect(option.id)}
          >
            <Show when={option.icon}>
              {(icon) => (
                <span class="size-4 flex items-center justify-center shrink-0 text-ink-muted">
                  {icon()()}
                </span>
              )}
            </Show>
            <span class="flex-1 truncate">{option.label}</span>
            <Show when={active()}>
              <CheckIcon class="size-3.5 text-accent shrink-0" />
            </Show>
          </button>
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
        <div class="flex bg-surface mb-px" role="radiogroup" aria-label="Match">
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
                    'flex-1 px-3 py-2 text-sm transition-colors hover:bg-hover',
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
        <div class="flex items-center gap-2 px-3 py-2 muted bg-surface mb-px">
          <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
          <input
            type="text"
            aria-label={props.facet.placeholder}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={props.facet.placeholder}
            class="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
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
              <div class="w-full flex items-stretch bg-surface not-last:mb-px">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={active()}
                  class="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-hover transition-colors text-left"
                  onClick={() => toggle(option.id)}
                >
                  <span
                    class={cn(
                      'size-4 flex items-center justify-center shrink-0 rounded border transition-colors',
                      active() ? 'bg-accent border-accent' : 'border-edge'
                    )}
                  >
                    <Show when={active()}>
                      <CheckIcon class="size-2.5 text-surface" />
                    </Show>
                  </span>
                  <Show when={option.icon}>
                    {(icon) => (
                      <span class="size-4 flex items-center justify-center shrink-0">
                        {icon()()}
                      </span>
                    )}
                  </Show>
                  <span
                    class={cn(
                      'flex-1 truncate',
                      active() ? 'text-ink' : 'text-ink-muted'
                    )}
                  >
                    {option.label}
                  </span>
                </button>
                <Show
                  when={props.facet.onOnly && props.facet.options().length > 1}
                >
                  <button
                    type="button"
                    class="shrink-0 px-3 text-xs text-ink-muted hover:text-ink hover:bg-hover transition-colors"
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
        <Accordion.Trigger class="w-full flex bg-surface items-center justify-between p-3 text-sm text-ink hover:bg-hover transition-colors outline-none group mb-px">
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
      <Accordion.Content>
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

  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();

  return (
    <MobileDrawer
      side="bottom"
      preventScroll={false}
      preventScrollbarShift={false}
      breakPoints={[0.85]}
    >
      <MobileDrawer.Trigger
        as={Button}
        aria-label="Open search filters"
        variant="ghost"
        size="sm"
        depth={3}
        class={cn(
          'island bg-chrome pointer-events-auto relative size-10 shrink-0 rounded-full [&_svg]:size-5',
          props.class
        )}
        ref={pressPulse}
      >
        <SlidersHorizontalIcon />
        <Show when={activeCount() > 0}>
          <span class="absolute -top-0.5 right-0 translate-x-1/2 size-4 flex items-center justify-center rounded-full bg-accent text-surface text-xxs font-medium leading-none">
            {activeCount()}
          </span>
        </Show>
      </MobileDrawer.Trigger>

      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Search filters" class="h-[80vh]">
          <MobileDrawer.Handle class="pb-1" />

          <div class="relative flex-1 min-h-0">
            <ScrollIndicators scrollRef={scrollRef} noBorderStart noBorderEnd />
            <div
              ref={setScrollRef}
              onFocusIn={(e) => scrollToFocusedInput(e)}
              class="overflow-y-auto scrollbar-hidden h-full pb-1"
            >
              <MobileDrawer.Label>Filters</MobileDrawer.Label>
              <Accordion multiple collapsible defaultValue={['type']}>
                <For each={facets()}>
                  {(facet) => <FacetSection facet={facet} />}
                </For>
              </Accordion>
            </div>
          </div>

          <Show when={activeCount() > 0}>
            <div class="shrink-0 border-t border-edge-muted p-2">
              <Button
                onClick={resetAll}
                variant="outline"
                size="sm"
                class="min-h-10 rounded-lg bg-active!"
              >
                <XIcon class="size-3!" />
                Clear all
              </Button>
            </div>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
};
