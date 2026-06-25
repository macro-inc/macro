import { useAddInboxGate } from '@app/component/AddInboxDialog';
import {
  MobileDrawer,
  scrollToFocusedInput,
} from '@app/component/mobile/MobileDrawer';
import { pressPulse } from '@app/component/mobile/pressPulse';
import {
  type FilterContext,
  NO_ASSIGNEE,
} from '@app/component/next-soup/filters';
import {
  buildDocumentTypeQuery,
  getActiveDocumentTypeFilterIds,
  isDocumentTypeFilterId,
} from '@app/component/next-soup/filters/configs/document-type-query';
import {
  CHANNEL_SORT_OPTIONS,
  DEFAULT_SORT_OPTIONS,
  DOCUMENT_SORT_OPTIONS,
  EMAIL_SORT_OPTIONS,
  type SortOption,
  type SystemSortOption,
  TASK_SORT_OPTIONS,
} from '@app/component/next-soup/soup-view/sort-options';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { UserIcon } from '@core/component/UserIcon';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { ENABLE_MULTI_INBOX_OVERRIDE } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { Accordion } from '@kobalte/core/accordion';
import ChevronDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import CircleDashedIcon from '@phosphor/circle-dashed.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import SlidersHorizontalIcon from '@phosphor-icons/core/regular/sliders-horizontal.svg?component-solid';
import { useContacts } from '@queries/contacts/contacts';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { ConsolidatedFilterChip } from './consolidated-filter-chip';
import { useInboxPicker } from './inbox-picker';
import {
  buildContactLabel,
  type FilterOption,
  VIEW_FILTER_CATEGORIES,
} from './unified-filter-dropdown';
import { useFilterRefinements } from './use-filter-refinements';

function scrollAccordionItemToTop(
  e: MouseEvent,
  scrollEl: HTMLElement | undefined
) {
  if (!scrollEl) return;
  const item = (e.currentTarget as HTMLElement).closest(
    '[data-closed],[data-expanded]'
  ) as HTMLElement | null;
  if (!item) return;
  requestAnimationFrame(() => {
    if (!item.hasAttribute('data-expanded')) return;
    const containerRect = scrollEl.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    scrollEl.scrollTo({
      top: scrollEl.scrollTop + (itemRect.top - containerRect.top),
      behavior: 'smooth',
    });
  });
}

export const MobileFilterDrawer = () => {
  const { consolidatedFiltersList, resetToTabDefaults } =
    useFilterRefinements();

  const {
    soup,
    queryFilters,
    assigneeFilter,
    setAssigneeFilter,
    inboxFilter,
    setInboxFilter,
  } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contacts = useContacts();
  const userId = useUserId();

  const [assigneeSearch, setAssigneeSearch] = createSignal('');

  const currentView = createMemo((): ListView | undefined => {
    const content = panel.handle.content();
    if (content.type !== 'component' || !isListViewID(content.id))
      return undefined;
    return content.id;
  });

  const categories = createMemo(() => {
    const view = currentView();
    if (!view) return [];
    return VIEW_FILTER_CATEGORIES[view] ?? [];
  });

  const isTasksView = () => currentView() === 'tasks';

  const picker = useInboxPicker({
    selectedIds: inboxFilter,
    setSelectedIds: setInboxFilter,
  });
  const multiInboxFlag = useFeatureFlag('enable-multi-inbox', {
    enabledOverride: ENABLE_MULTI_INBOX_OVERRIDE,
  });
  const addInbox = useAddInboxFlow();
  const guardAddInbox = useAddInboxGate();

  // Mirrors the desktop InboxSelector's visibility rule so the "Add inbox"
  // action stays discoverable with zero or one inbox connected. Also stays
  // visible while a scope is active so it can be reset even if the linked
  // inboxes drop to one.
  const showInboxSection = () =>
    currentView() === 'mail' &&
    (multiInboxFlag().enabled ||
      picker.hasMultiple() ||
      inboxFilter() !== undefined);

  const toggleInbox = (id: string) => {
    const current = picker.activeIds();
    const next = current.includes(id)
      ? current.filter((activeId) => activeId !== id)
      : [...current, id];
    return next.length ? picker.onChange(next) : picker.reset();
  };

  const VIEW_SORT_OPTIONS: Partial<Record<ListView, SortOption[]>> = {
    inbox: DEFAULT_SORT_OPTIONS,
    agents: DEFAULT_SORT_OPTIONS,
    mail: EMAIL_SORT_OPTIONS,
    documents: DOCUMENT_SORT_OPTIONS,
    tasks: TASK_SORT_OPTIONS,
    channels: CHANNEL_SORT_OPTIONS,
    folders: DEFAULT_SORT_OPTIONS,
  };

  const sortOptions = createMemo(() => {
    const view = currentView();
    if (!view) return [];
    return VIEW_SORT_OPTIONS[view] ?? [];
  });

  const activeSort = createMemo(
    () => (soup.sort.active()[0]?.id as SystemSortOption) ?? 'updated_at'
  );
  const setSort = (value: SystemSortOption) => soup.sort.setAll([value]);

  const hasFiltersOrCategories = () =>
    categories().length > 0 ||
    isTasksView() ||
    sortOptions().length > 0 ||
    showInboxSection();

  const toggleFilter = (optionId: FilterOption['id']) => {
    const wasActive = soup.predicates.isActive(optionId);
    const previousDocumentTypeIds =
      currentView() === 'documents' && isDocumentTypeFilterId(optionId)
        ? getActiveDocumentTypeFilterIds(soup.predicates.isActive)
        : undefined;

    soup.predicates.toggle({ or: [optionId] });

    if (previousDocumentTypeIds) {
      const previousQuery = buildDocumentTypeQuery(previousDocumentTypeIds);
      const nextQuery = buildDocumentTypeQuery(
        getActiveDocumentTypeFilterIds(soup.predicates.isActive)
      );
      if (previousQuery) queryFilters.remove(previousQuery);
      if (nextQuery) queryFilters.add(nextQuery);
      return;
    }

    const filter = soup.predicates.getConfig(optionId);
    if (!filter?.query) return;

    const ctx: FilterContext = {
      userId: userId(),
      assignees: assigneeFilter(),
    };
    const query =
      typeof filter.query === 'function' ? filter.query(ctx) : filter.query;

    if (wasActive) {
      queryFilters.remove(query);
    } else {
      queryFilters.add(query);
    }
  };

  const toggleAssignee = (id: string) => {
    const current = assigneeFilter();
    if (current.includes(id)) {
      setAssigneeFilter(current.filter((a) => a !== id));
    } else {
      setAssigneeFilter([...current, id]);
    }
  };

  const assigneeOptions = createMemo(() => {
    const currentUserId = userId();
    const noAssigneeOption = {
      id: NO_ASSIGNEE,
      label: 'Unassigned',
      icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
    };
    let meOption: typeof noAssigneeOption | undefined;
    const otherContactOptions: (typeof noAssigneeOption)[] = [];
    for (const contact of contacts()) {
      const opt = {
        id: contact.id,
        label: buildContactLabel(contact, currentUserId),
        icon: () => (
          <UserIcon
            id={contact.id}
            size="sm"
            suppressClick
            showTooltip={false}
          />
        ),
      };
      if (contact.id === currentUserId) {
        meOption = opt;
      } else {
        otherContactOptions.push(opt);
      }
    }
    return [
      ...(meOption ? [meOption] : []),
      noAssigneeOption,
      ...otherContactOptions,
    ];
  });

  const filteredAssigneeOptions = createMemo(() => {
    const query = assigneeSearch().toLowerCase();
    if (!query) return assigneeOptions();
    return assigneeOptions().filter((o) =>
      o.label.toLowerCase().includes(query)
    );
  });

  const activeCount = () => consolidatedFiltersList().length;

  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();

  return (
    <Show when={hasFiltersOrCategories()}>
      <MobileDrawer
        side="bottom"
        preventScroll={false}
        preventScrollbarShift={false}
        breakPoints={[0.85]}
      >
        <MobileDrawer.Trigger
          as={Button}
          aria-label="Open filters"
          variant="ghost"
          size="sm"
          depth={3}
          class="island pointer-events-auto relative size-10 shrink-0 rounded-full bg-surface [&_svg]:size-5"
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
          <MobileDrawer.Content aria-label="Filters" class="h-[80vh]">
            <MobileDrawer.Handle class="pb-1" />

            {/* Scrollable filter list */}
            <div class="relative flex-1 min-h-0">
              <ScrollIndicators
                scrollRef={scrollRef}
                noBorderStart
                noBorderEnd
              />
              <div
                ref={setScrollRef}
                onFocusIn={(e) => scrollToFocusedInput(e)}
                class="overflow-y-auto scrollbar-hidden h-full pb-1"
              >
                {/* Sort section */}
                <Show when={sortOptions().length > 0}>
                  <MobileDrawer.Label id="sort-section-label">
                    Sort
                  </MobileDrawer.Label>
                  <MobileDrawer.Section
                    role="radiogroup"
                    aria-labelledby="sort-section-label"
                  >
                    <For each={sortOptions()}>
                      {(option) => {
                        const active = () => activeSort() === option.value;
                        return (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={active()}
                            class="w-full bg-surface flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-hover transition-colors text-left not-last:mb-px"
                            onClick={() => setSort(option.value)}
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
                  </MobileDrawer.Section>
                </Show>

                <Accordion
                  multiple
                  collapsible
                  defaultValue={[categories()[0]?.id ?? 'assignee']}
                >
                  {/* Filter section */}
                  <Show
                    when={
                      categories().length > 0 ||
                      isTasksView() ||
                      showInboxSection()
                    }
                  >
                    <MobileDrawer.Label class="pt-4">
                      Filters
                    </MobileDrawer.Label>
                  </Show>

                  <Show when={showInboxSection()}>
                    <MobileDrawer.Section
                      as={Accordion.Item}
                      value="inboxes"
                      class="mb-3"
                    >
                      <Accordion.Header>
                        <Accordion.Trigger
                          class="w-full flex bg-surface items-center justify-between p-3 text-sm text-ink hover:bg-hover transition-colors outline-none group mb-px"
                          onClick={(e) =>
                            scrollAccordionItemToTop(e, scrollRef())
                          }
                        >
                          <span class="font-medium">Inboxes</span>
                          <div class="flex items-center gap-2">
                            <Show when={inboxFilter() !== undefined}>
                              <span class="group-data-expanded:hidden size-4 flex items-center justify-center rounded-full bg-accent text-surface text-xxs font-medium leading-none">
                                {picker.activeIds().length}
                              </span>
                            </Show>
                            <ChevronDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-expanded:rotate-180" />
                          </div>
                        </Accordion.Trigger>
                      </Accordion.Header>
                      <Accordion.Content>
                        <For each={picker.options()}>
                          {(option) => {
                            const active = () =>
                              picker.activeIds().includes(option.id);
                            const isSole = () => {
                              const ids = picker.activeIds();
                              return ids.length === 1 && ids[0] === option.id;
                            };
                            return (
                              <div class="w-full flex items-stretch bg-surface not-last:mb-px">
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={active()}
                                  class="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-hover transition-colors text-left"
                                  onClick={() => toggleInbox(option.id)}
                                >
                                  <span
                                    class={cn(
                                      'size-4 flex items-center justify-center shrink-0 rounded border transition-colors',
                                      active()
                                        ? 'bg-accent border-accent'
                                        : 'border-edge'
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
                                <Show when={picker.hasMultiple()}>
                                  <button
                                    type="button"
                                    class="shrink-0 px-3 text-xs text-ink-muted hover:text-ink hover:bg-hover transition-colors"
                                    aria-label={
                                      isSole()
                                        ? 'Show all inboxes'
                                        : `Show only ${option.label}`
                                    }
                                    onClick={() => picker.selectOnly(option.id)}
                                  >
                                    {isSole() ? 'All' : 'Only'}
                                  </button>
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                        <Show when={multiInboxFlag().enabled}>
                          <button
                            type="button"
                            class="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-hover transition-colors text-left bg-surface not-last:mb-px"
                            onClick={() => guardAddInbox(() => void addInbox())}
                          >
                            <span class="size-4 flex items-center justify-center shrink-0">
                              <PlusIcon class="size-4 text-ink-muted" />
                            </span>
                            <span class="flex-1 truncate">Add inbox</span>
                          </button>
                        </Show>
                      </Accordion.Content>
                    </MobileDrawer.Section>
                  </Show>

                  <div class="flex flex-col">
                    <For each={categories()}>
                      {(category) => {
                        const activeCount = createMemo(
                          () =>
                            category.options.filter((o) =>
                              soup.predicates.isActive(o.id)
                            ).length
                        );
                        return (
                          <MobileDrawer.Section
                            as={Accordion.Item}
                            value={category.id}
                            class="mb-3"
                          >
                            <Accordion.Header>
                              <Accordion.Trigger
                                class="w-full flex bg-surface items-center justify-between p-3 text-sm text-ink hover:bg-hover transition-colors outline-none group mb-px"
                                onClick={(e) =>
                                  scrollAccordionItemToTop(e, scrollRef())
                                }
                              >
                                <span class="font-medium">
                                  {category.label}
                                </span>
                                <div class="flex items-center gap-2">
                                  <Show when={activeCount() > 0}>
                                    <span class="group-data-expanded:hidden size-4 flex items-center justify-center rounded-full bg-accent text-surface text-xxs font-medium leading-none">
                                      {activeCount()}
                                    </span>
                                  </Show>
                                  <ChevronDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-expanded:rotate-180" />
                                </div>
                              </Accordion.Trigger>
                            </Accordion.Header>
                            <Accordion.Content>
                              <For each={category.options}>
                                {(option) => {
                                  const active = () =>
                                    soup.predicates.isActive(option.id);
                                  return (
                                    <button
                                      type="button"
                                      role="checkbox"
                                      aria-checked={active()}
                                      class="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-hover transition-colors text-left bg-surface not-last:mb-px"
                                      onClick={() => toggleFilter(option.id)}
                                    >
                                      <span
                                        class={cn(
                                          'size-4 flex items-center justify-center shrink-0 border transition-colors',
                                          active()
                                            ? 'bg-accent border-accent'
                                            : 'border-edge'
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
                                      <span class={cn('flex-1 truncate')}>
                                        {option.label}
                                      </span>
                                    </button>
                                  );
                                }}
                              </For>
                            </Accordion.Content>
                          </MobileDrawer.Section>
                        );
                      }}
                    </For>
                  </div>

                  {/* Assignee section for tasks view */}
                  <Show when={isTasksView()}>
                    <MobileDrawer.Section as={Accordion.Item} value="assignee">
                      <Accordion.Header>
                        <Accordion.Trigger
                          class="w-full flex items-center justify-between p-3 text-sm text-ink hover:bg-hover transition-colors outline-none group bg-surface mb-px"
                          onClick={(e) =>
                            scrollAccordionItemToTop(e, scrollRef())
                          }
                        >
                          <span class="font-medium">Assignee</span>
                          <div class="flex items-center gap-2">
                            <Show when={assigneeFilter().length > 0}>
                              <span class="group-data-expanded:hidden size-4 flex items-center justify-center rounded-full bg-accent text-surface text-xxs font-medium leading-none">
                                {assigneeFilter().length}
                              </span>
                            </Show>
                            <ChevronDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-expanded:rotate-180" />
                          </div>
                        </Accordion.Trigger>
                      </Accordion.Header>
                      <Accordion.Content>
                        {/* Search */}
                        <div class="flex items-center gap-2 px-3 py-2 muted bg-surface mb-px">
                          <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
                          <input
                            type="text"
                            aria-label="Search assignees"
                            value={assigneeSearch()}
                            onInput={(e) =>
                              setAssigneeSearch(e.currentTarget.value)
                            }
                            placeholder="Search assignees..."
                            class="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-muted"
                          />
                        </div>
                        <div class="max-h-[calc(50*var(--dvh))] overflow-y-auto scrollbar-hidden">
                          <For each={filteredAssigneeOptions()}>
                            {(option) => {
                              const active = () =>
                                assigneeFilter().includes(option.id);
                              return (
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={active()}
                                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover transition-colors text-left bg-surface not-last:mb-px"
                                  onClick={() => toggleAssignee(option.id)}
                                >
                                  <span
                                    class={cn(
                                      'size-4 flex items-center justify-center shrink-0 rounded border transition-colors',
                                      active()
                                        ? 'bg-accent border-accent'
                                        : 'border-edge'
                                    )}
                                  >
                                    <Show when={active()}>
                                      <CheckIcon class="size-2.5 text-surface" />
                                    </Show>
                                  </span>
                                  <span class="size-4 flex items-center justify-center shrink-0">
                                    {option.icon()}
                                  </span>
                                  <span
                                    class={cn(
                                      'flex-1 truncate',
                                      active() ? 'text-ink' : 'text-ink-muted'
                                    )}
                                  >
                                    {option.label}
                                  </span>
                                </button>
                              );
                            }}
                          </For>
                        </div>

                        <Show when={filteredAssigneeOptions().length === 0}>
                          <div class="px-4 py-2 text-sm text-ink-muted">
                            No results
                          </div>
                        </Show>
                      </Accordion.Content>
                    </MobileDrawer.Section>
                  </Show>
                </Accordion>
              </div>
            </div>

            {/* Active filter chips footer */}
            <Show when={activeCount() > 0}>
              <div class="shrink-0 border-t border-edge-muted p-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <For each={consolidatedFiltersList()}>
                    {(filter) => (
                      <ConsolidatedFilterChip
                        filter={filter}
                        hideCategoryLabel
                        mobile
                      />
                    )}
                  </For>
                  <Button
                    onClick={() => resetToTabDefaults()}
                    variant="base"
                    size="sm"
                    class="min-h-10 rounded-lg bg-active!"
                  >
                    <XIcon class="size-3!" />
                    Clear all
                  </Button>
                </div>
              </div>
            </Show>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
};
