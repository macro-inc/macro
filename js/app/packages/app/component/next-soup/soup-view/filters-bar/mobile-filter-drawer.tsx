import Drawer from '@corvu/drawer';
import { Accordion } from '@kobalte/core/accordion';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import SlidersHorizontalIcon from '@macro-icons/wide/sliders-horizontal.svg';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import CircleDashedIcon from '@icon/regular/circle-dashed.svg';
import { Button } from './button';
import {
  VIEW_FILTER_CATEGORIES,
  buildContactLabel,
  type FilterOption,
} from './unified-filter-dropdown';
import { ActiveFilterChips } from './active-filter-chips';
import { useFilterRefinements } from './use-filter-refinements';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useContacts } from '@queries/contacts/contacts';
import { useUserId } from '@core/context/user';
import { NO_ASSIGNEE } from '@app/component/next-soup/soup-view/task-sub-filter-matcher';
import { UserIcon } from '@core/component/UserIcon';
import {
  DEFAULT_SORT_OPTIONS,
  TASK_SORT_OPTIONS,
  DOCUMENT_SORT_OPTIONS,
  EMAIL_SORT_OPTIONS,
  CHANNEL_SORT_OPTIONS,
  type SystemSortOption,
  type SortOption,
} from '@app/component/next-soup/soup-view/sort-options';

export const MobileFilterDrawer = () => {
  const {
    activeFiltersList,
    removeFilter,
    replaceFilter,
    resetToTabDefaults,
    isOptionActive,
  } = useFilterRefinements();

  const { soup, assigneeFilter, setAssigneeFilter } = useSoupView();
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
    categories().length > 0 || isTasksView() || sortOptions().length > 0;

  const toggleFilter = (optionId: FilterOption['id']) => {
    soup.filters.toggle({ or: [optionId] });
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
    const contactOptions = contacts().map((contact) => ({
      id: contact.id,
      label: buildContactLabel(contact, currentUserId),
      icon: () => (
        <UserIcon id={contact.id} size="xs" suppressClick showTooltip={false} />
      ),
    }));
    return [noAssigneeOption, ...contactOptions];
  });

  const filteredAssigneeOptions = createMemo(() => {
    const query = assigneeSearch().toLowerCase();
    if (!query) return assigneeOptions();
    return assigneeOptions().filter((o) =>
      o.label.toLowerCase().includes(query)
    );
  });

  const activeCount = () => activeFiltersList().length;

  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();

  return (
    <Show when={hasFiltersOrCategories()}>
      <Drawer
        side="bottom"
        preventScroll={false}
        preventScrollbarShift={false}
        breakPoints={[0.85]}
      >
        <Drawer.Trigger
          as={Button}
          aria-label="Open filters"
          variant="ghost"
          size="sm"
          class="rounded-xs [&_svg]:size-6 relative"
        >
          <SlidersHorizontalIcon />
          <Show when={activeCount() > 0}>
            <span class="absolute -top-0.5 right-0 translate-x-1/2 size-4 flex items-center justify-center rounded-full bg-accent text-page text-[10px] font-medium leading-none">
              {activeCount()}
            </span>
          </Show>
        </Drawer.Trigger>

        <Drawer.Portal>
          <Drawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay" />
          <Drawer.Content
            aria-label="Filters"
            class="fixed bottom-0 left-0 right-0 z-modal bg-menu rounded-t-lg shadow-lg flex flex-col h-[80dvh] border-l border-r border-t border-edge transition-transform duration-100 ease-out data-[closing]:ease-in pb-(--safe-bottom)"
          >
            {/* Drag handle */}
            <div class="flex justify-center pt-3 pb-1 shrink-0">
              <div class="w-10 h-1 rounded-full bg-edge-muted" />
            </div>

            {/* Header */}
            {/*
            <div class="flex items-center justify-between px-4 pb-2 shrink-0 border-b border-edge-muted/50">
              <span class="text-md font-md text-ink-muted">Filters</span>
              <div class="flex items-center gap-2">
                <Drawer.Close
                  as={Button}
                  variant="ghost"
                  class="rounded-xs size-11 [&_svg]:size-6 px-1"
                >
                  <XIcon />
                </Drawer.Close>
              </div>
            </div>
            */}

            {/* Scrollable filter list */}
            <div class="relative flex-1 min-h-0">
              <ScrollIndicators
                scrollRef={scrollRef}
                noBorderStart
                noBorderEnd
              />
              <div
                ref={setScrollRef}
                class="overflow-y-auto scrollbar-hidden h-full pb-1"
              >
                {/* Sort section */}
                <Show when={sortOptions().length > 0}>
                  <div class="px-4 pb-2 border-b border-edge-muted/30">
                    <span
                      id="sort-section-label"
                      class="text-xs font-medium text-ink-muted uppercase tracking-wide"
                    >
                      Sort
                    </span>
                  </div>
                  <div role="radiogroup" aria-labelledby="sort-section-label">
                    <For each={sortOptions()}>
                      {(option) => {
                        const active = () => activeSort() === option.value;
                        return (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={active()}
                            class="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover transition-colors text-left"
                            onClick={() => setSort(option.value)}
                          >
                            <Show when={option.icon}>
                              {(icon) => (
                                <span class="size-4 flex items-center justify-center shrink-0 text-ink-muted">
                                  {icon()()}
                                </span>
                              )}
                            </Show>
                            <span
                              class={cn(
                                'flex-1 truncate',
                                active()
                                  ? 'text-ink font-medium'
                                  : 'text-ink-muted'
                              )}
                            >
                              {option.label}
                            </span>
                            <Show when={active()}>
                              <CheckIcon class="size-3.5 text-accent shrink-0" />
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>

                <Accordion
                  multiple
                  collapsible
                  defaultValue={[categories()[0]?.id ?? 'assignee']}
                >
                  {/* Filter section */}
                  <Show when={categories().length > 0 || isTasksView()}>
                    <div class="px-4 pt-4 pb-2 border-b border-edge-muted/30">
                      <span class="text-xs font-medium text-ink-muted uppercase tracking-wide">
                        Filters
                      </span>
                    </div>
                  </Show>

                  <For each={categories()}>
                    {(category) => {
                      const activeCount = createMemo(
                        () =>
                          category.options.filter((o) =>
                            soup.filters.isActive(o.id)
                          ).length
                      );
                      return (
                        <Accordion.Item
                          value={category.id}
                          class="border-b border-edge-muted/30 last:border-b-0"
                        >
                          <Accordion.Header>
                            <Accordion.Trigger class="w-full flex items-center justify-between px-4 py-3 text-sm text-ink hover:bg-hover transition-colors outline-none group">
                              <span class="font-medium">{category.label}</span>
                              <div class="flex items-center gap-2">
                                <Show when={activeCount() > 0}>
                                  <span class="group-data-[expanded]:hidden size-4 flex items-center justify-center rounded-full bg-accent text-page text-[10px] font-medium leading-none">
                                    {activeCount()}
                                  </span>
                                </Show>
                                <ChevronDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-[expanded]:rotate-180" />
                              </div>
                            </Accordion.Trigger>
                          </Accordion.Header>
                          <Accordion.Content class="pb-1">
                            <For each={category.options}>
                              {(option) => {
                                const active = () =>
                                  soup.filters.isActive(option.id);
                                return (
                                  <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={active()}
                                    class="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover transition-colors text-left"
                                    onClick={() => toggleFilter(option.id)}
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
                                        <CheckIcon class="size-2.5 text-page" />
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
                        </Accordion.Item>
                      );
                    }}
                  </For>

                  {/* Assignee section for tasks view */}
                  <Show when={isTasksView()}>
                    <Accordion.Item
                      value="assignee"
                      class="border-b border-edge-muted/30 last:border-b-0"
                    >
                      <Accordion.Header>
                        <Accordion.Trigger class="w-full flex items-center justify-between px-4 py-3 text-sm text-ink hover:bg-hover transition-colors outline-none group">
                          <span class="font-medium">Assignee</span>
                          <div class="flex items-center gap-2">
                            <Show when={assigneeFilter().length > 0}>
                              <span class="group-data-[expanded]:hidden size-4 flex items-center justify-center rounded-full bg-accent text-page text-[10px] font-medium leading-none">
                                {assigneeFilter().length}
                              </span>
                            </Show>
                            <ChevronDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-[expanded]:rotate-180" />
                          </div>
                        </Accordion.Trigger>
                      </Accordion.Header>
                      <Accordion.Content class="pb-1">
                        {/* Search */}
                        <div class="flex items-center gap-2 px-4 py-2 border-b border-edge-muted/50 mb-1">
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
                        <For each={filteredAssigneeOptions()}>
                          {(option) => {
                            const active = () =>
                              assigneeFilter().includes(option.id);
                            return (
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={active()}
                                class="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover transition-colors text-left"
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
                                    <CheckIcon class="size-2.5 text-page" />
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
                        <Show when={filteredAssigneeOptions().length === 0}>
                          <div class="px-4 py-2 text-sm text-ink-muted">
                            No results
                          </div>
                        </Show>
                      </Accordion.Content>
                    </Accordion.Item>
                  </Show>
                </Accordion>
              </div>
            </div>

            {/* Active filter chips footer */}
            <Show when={activeCount() > 0}>
              <div class="shrink-0 border-t border-edge-muted/50 py-2">
                <ActiveFilterChips
                  filters={activeFiltersList()}
                  onRemove={removeFilter}
                  onReplace={replaceFilter}
                  onClearAll={resetToTabDefaults}
                  isOptionActive={isOptionActive}
                  chipClass="min-h-11"
                  hideCategoryLabel
                />
              </div>
            </Show>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </Show>
  );
};
