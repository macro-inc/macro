import { MobileFilterDrawer as FilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import {
  type FilterContext,
  NO_ASSIGNEE,
} from '@app/features/next-soup/filters';
import {
  buildDocumentTypeQuery,
  getActiveDocumentTypeFilterIds,
  isDocumentTypeFilterId,
} from '@app/features/next-soup/filters/configs/document-type-query';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import {
  CHANNEL_SORT_OPTIONS,
  DEFAULT_SORT_OPTIONS,
  DOCUMENT_SORT_OPTIONS,
  EMAIL_SORT_OPTIONS,
  type SortOption,
  type SystemSortOption,
  TASK_SORT_OPTIONS,
} from '@app/features/next-soup/soup-view/sort-options';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { UserIcon } from '@core/component/UserIcon';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { Accordion } from '@kobalte/core/accordion';
import CheckIcon from '@phosphor/check.svg';
import CircleDashedIcon from '@phosphor/circle-dashed.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import { useContacts } from '@queries/contacts/contacts';
import { cn } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { ConsolidatedFilterChip } from './consolidated-filter-chip';
import { useInboxPicker } from './inbox-picker';
import {
  buildContactLabel,
  type FilterOption,
  VIEW_FILTER_CATEGORIES,
} from './unified-filter-dropdown';
import { useFilterRefinements } from './use-filter-refinements';

export const MobileFilterDrawer = (props: {
  /** Extra classes on the trigger button (rendered only when filters exist). */
  class?: string;
}) => {
  const { consolidatedFiltersList, resetToTabDefaults, handleAssigneeChange } =
    useFilterRefinements();

  const {
    soup,
    queryFilters,
    assigneeFilter,
    activeTab,
    inboxFilter,
    setInboxFilter,
  } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const contacts = useContacts();
  const userId = useUserId();

  const [assigneeSearch, setAssigneeSearch] = createSignal('');
  const [createdBySearch, setCreatedBySearch] = createSignal('');

  const currentView = createMemo((): ListView | undefined => {
    const content = panel.handle.content();
    if (content.type !== 'component' || !isListViewID(content.id))
      return undefined;
    return content.id;
  });

  const categories = createMemo(() => {
    const view = currentView();
    if (!view) return [];
    if (view === 'documents' && activeTab() === 'folders') return [];
    return VIEW_FILTER_CATEGORIES[view] ?? [];
  });

  const isTasksView = () => currentView() === 'tasks';
  const isDocumentsView = () => currentView() === 'documents';
  const isCreatedByFilterView = () => {
    const view = currentView();
    return view === 'documents' || view === 'tasks';
  };
  const showCreatedByFilter = () =>
    isCreatedByFilterView() && !(isDocumentsView() && activeTab() === 'owned');

  const baseCreatedByIds = createMemo(() => {
    const view = currentView();
    if (view !== 'documents' && view !== 'tasks') return [];
    return (
      getViewPreset(view, activeTab(), {
        userId: userId(),
        isTeamAdmin: false,
      })?.filters.include?.documentOwnerId ?? []
    );
  });
  const createdByIds = createMemo(
    () => queryFilters.state.include.documentOwnerId ?? []
  );

  const picker = useInboxPicker({
    selectedIds: inboxFilter,
    setSelectedIds: setInboxFilter,
  });
  const multiInboxFlag = useFeatureFlag(enableMultiInbox);
  const addInbox = useAddInboxFlow();

  // Mirrors the desktop InboxSelector's visibility rule so the "Connect
  // another account" action stays discoverable with zero or one inbox
  // connected. Also stays
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

  // The inbox is deliberately absent: its order is fixed to updated_at, and
  // the desktop toolbar hides SoupViewContextSort there for the same reason.
  const VIEW_SORT_OPTIONS: Partial<Record<ListView, SortOption[]>> = {
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

  // Routes through handleAssigneeChange so the assignee predicate and the
  // server-side property query stay in sync with the selection — setting the
  // signal alone updates the badge but never filters the list.
  const toggleAssignee = (id: string) => {
    const current = assigneeFilter();
    handleAssigneeChange(
      current.includes(id) ? current.filter((a) => a !== id) : [...current, id]
    );
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

  const createdByOptions = createMemo(() => {
    const currentUserId = userId();
    return [...contacts()]
      .sort((a, b) => {
        if (a.id === currentUserId) return -1;
        if (b.id === currentUserId) return 1;
        return 0;
      })
      .map((contact) => ({
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
      }));
  });

  const filteredCreatedByOptions = createMemo(() => {
    const query = createdBySearch().toLowerCase();
    if (!query) return createdByOptions();
    return createdByOptions().filter((option) =>
      option.label.toLowerCase().includes(query)
    );
  });

  const toggleCreatedBy = (id: string) => {
    const current = createdByIds();
    const next = current.includes(id)
      ? current.filter((creatorId) => creatorId !== id)
      : [...current, id];
    const nextIds = next.length > 0 ? next : baseCreatedByIds();
    queryFilters.set({
      include: {
        documentOwnerId: nextIds.length > 0 ? nextIds : undefined,
      },
    });
  };

  const activeCount = () => consolidatedFiltersList().length;

  return (
    <Show when={hasFiltersOrCategories()}>
      <FilterDrawer
        class={props.class}
        activeCount={activeCount()}
        onClear={resetToTabDefaults}
        footer={
          <For each={consolidatedFiltersList()}>
            {(filter) => (
              <ConsolidatedFilterChip
                filter={filter}
                hideCategoryLabel
                mobile
              />
            )}
          </For>
        }
      >
        {/* Sort section */}
        <Show when={sortOptions().length > 0}>
          <MobileDrawer.Label id="sort-section-label">Sort</MobileDrawer.Label>
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
              categories().length > 0 || isTasksView() || showInboxSection()
            }
          >
            <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>
          </Show>

          <Show when={showInboxSection()}>
            <FilterDrawer.Section
              value="inboxes"
              label="Inboxes"
              activeCount={
                inboxFilter() !== undefined ? picker.activeIds().length : 0
              }
              class="mb-3"
            >
              <For each={picker.options()}>
                {(option) => {
                  const active = () => picker.activeIds().includes(option.id);
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
                  onClick={() => void addInbox()}
                >
                  <span class="size-4 flex items-center justify-center shrink-0">
                    <PlusIcon class="size-4 text-ink-muted" />
                  </span>
                  <span class="flex-1 truncate">Connect another account</span>
                </button>
              </Show>
            </FilterDrawer.Section>
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
                  <FilterDrawer.Section
                    value={category.id}
                    label={category.label}
                    activeCount={activeCount()}
                    class="mb-3"
                  >
                    <For each={category.options}>
                      {(option) => {
                        const active = () =>
                          soup.predicates.isActive(option.id);
                        return (
                          <FilterDrawer.Option
                            checked={active()}
                            onChange={() => toggleFilter(option.id)}
                            icon={option.icon?.()}
                          >
                            {option.label}
                          </FilterDrawer.Option>
                        );
                      }}
                    </For>
                  </FilterDrawer.Section>
                );
              }}
            </For>
          </div>

          {/* Assignee section for tasks view */}
          <Show when={isTasksView()}>
            <FilterDrawer.Section
              value="assignee"
              label="Assignee"
              activeCount={assigneeFilter().length}
            >
              {/* Search */}
              <div class="flex items-center gap-2 px-3 py-2 muted bg-surface mb-px">
                <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
                <input
                  type="text"
                  aria-label="Search assignees"
                  value={assigneeSearch()}
                  onInput={(e) => setAssigneeSearch(e.currentTarget.value)}
                  placeholder="Search assignees..."
                  class="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
                />
              </div>
              <div class="max-h-[calc(50*var(--dvh))] overflow-y-auto scrollbar-hidden">
                <For each={filteredAssigneeOptions()}>
                  {(option) => {
                    const active = () => assigneeFilter().includes(option.id);
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
                            active() ? 'bg-accent border-accent' : 'border-edge'
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
                <div class="px-4 py-2 text-sm text-ink-muted">No results</div>
              </Show>
            </FilterDrawer.Section>
          </Show>

          {/* Created by section for Tasks and Files */}
          <Show when={showCreatedByFilter()}>
            <FilterDrawer.Section
              value="created-by"
              label="Created by"
              activeCount={createdByIds().length}
            >
              <div class="flex items-center gap-2 px-3 py-2 muted bg-surface mb-px">
                <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
                <input
                  type="text"
                  aria-label="Search creators"
                  value={createdBySearch()}
                  onInput={(e) => setCreatedBySearch(e.currentTarget.value)}
                  placeholder="Search creators..."
                  class="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
                />
              </div>
              <div class="max-h-[calc(50*var(--dvh))] overflow-y-auto scrollbar-hidden">
                <For each={filteredCreatedByOptions()}>
                  {(option) => {
                    const active = () => createdByIds().includes(option.id);
                    return (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={active()}
                        class="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover transition-colors text-left bg-surface not-last:mb-px"
                        onClick={() => toggleCreatedBy(option.id)}
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
              <Show when={filteredCreatedByOptions().length === 0}>
                <div class="px-4 py-2 text-sm text-ink-muted">No results</div>
              </Show>
            </FilterDrawer.Section>
          </Show>
        </Accordion>
      </FilterDrawer>
    </Show>
  );
};
