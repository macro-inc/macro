import type { ListView } from '@app/constants/list-views';
import { isListViewID, TAGGABLE_LIST_VIEWS } from '@app/constants/list-views';
import {
  type FilterContext,
  NO_ASSIGNEE,
} from '@app/features/next-soup/filters/configs/';
import {
  buildDocumentTypeQuery,
  getActiveDocumentTypeFilterIds,
  isDocumentTypeFilterId,
} from '@app/features/next-soup/filters/configs/document-type-query';
import {
  defineQueryFilters,
  type PropertyFilter,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { mergeQuery } from '@app/features/next-soup/filters/filter-store/query-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import {
  type ReadFilter,
  useSoupView,
} from '@app/features/next-soup/soup-view/soup-view-context';
import { t } from '@app/lib/i18n';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import CircleDashedIcon from '@phosphor/circle-dashed.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useGithubLinkStatusQuery } from '@queries/auth';
import { useContacts } from '@queries/contacts/contacts';
import { type ButtonVariant, cn, Dropdown, Tooltip } from '@ui';
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import {
  type FilterCategory,
  filterInboxGithubPrOption,
} from './filter-categories';
import {
  FilterOptionItem,
  FilterSubmenu,
  SearchableFilterSubmenu,
} from './filter-menu';
import type { SearchableOption } from './searchable-multi-select';

import { useTagFilter } from './tag-filter';

export type { FilterCategory, FilterOption } from './filter-categories';

// Filter categories by view
const HOME_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'type',
    get label() {
      return t('viewMenus.type');
    },
    get labelPlural() {
      return t('viewMenus.types');
    },
    options: [
      {
        id: 'document',
        get label() {
          return t('viewMenus.docs');
        },
        icon: () => <EntityIcon targetType="md" size="xs" />,
      },
      {
        id: 'agent',
        get label() {
          return t('viewMenus.agents');
        },
        icon: () => <EntityIcon targetType="chat" size="xs" />,
      },
      {
        id: 'people',
        get label() {
          return t('viewMenus.people');
        },
        icon: () => <EntityIcon targetType="direct_message" size="xs" />,
      },
      {
        id: 'teams',
        get label() {
          return t('viewMenus.teams');
        },
        icon: () => <EntityIcon targetType="channel" size="xs" />,
      },
      {
        id: 'task',
        get label() {
          return t('viewMenus.tasks');
        },
        icon: () => <EntityIcon targetType="task" size="xs" />,
      },
      {
        id: 'email',
        get label() {
          return t('viewMenus.mail');
        },
        icon: () => <EntityIcon targetType="email" size="xs" />,
      },
      {
        id: 'file',
        get label() {
          return t('viewMenus.files');
        },
        icon: () => <EntityIcon targetType="files" size="xs" />,
      },
      {
        id: 'github-pr',
        get label() {
          return t('viewMenus.githubPrs');
        },
        icon: () => <EntityIcon targetType="githubPullRequest" size="xs" />,
      },
    ],
    multiple: true,
  },
];

const isInboxTypeFilterId = (id: string) => {
  for (const category of HOME_FILTER_CATEGORIES) {
    if (category.options.find((o) => o.id === id)) return true;
  }

  return false;
};

const MAIL_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'status',
    get label() {
      return t('viewMenus.status');
    },
    get labelPlural() {
      return t('viewMenus.statuses');
    },
    options: [
      {
        id: 'unread',
        get label() {
          return t('viewMenus.unread');
        },
      },
      {
        id: 'read',
        get label() {
          return t('viewMenus.read');
        },
      },
      {
        id: 'not-done',
        get label() {
          return t('viewMenus.notDone');
        },
      },
      {
        id: 'done',
        get label() {
          return t('viewMenus.done');
        },
      },
    ],
    multiple: true,
  },
  {
    id: 'attachment',
    get label() {
      return t('viewMenus.attachments');
    },
    get labelPlural() {
      return t('viewMenus.attachments');
    },
    options: [
      {
        id: 'attachment-pdf',
        get label() {
          return t('viewMenus.pdfs');
        },
        icon: () => <EntityIcon targetType="pdf" size="xs" />,
      },
      {
        id: 'attachment-image',
        get label() {
          return t('viewMenus.images');
        },
        icon: () => <EntityIcon targetType="image" size="xs" />,
      },
      {
        id: 'attachment-document',
        get label() {
          return t('viewMenus.documents');
        },
        icon: () => <EntityIcon targetType="files" size="xs" />,
      },
    ],
    multiple: true,
  },
  {
    id: 'calendar',
    get label() {
      return t('viewMenus.calendar');
    },
    get labelPlural() {
      return t('viewMenus.calendar');
    },
    options: [
      {
        id: 'has-calendar-invite',
        get label() {
          return t('viewMenus.hasCalendarInvite');
        },
      },
    ],
    multiple: false,
  },
];

const TASKS_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'status',
    get label() {
      return t('viewMenus.status');
    },
    get labelPlural() {
      return t('viewMenus.statuses');
    },
    options: [
      {
        id: 'task-not-started',
        get label() {
          return t('viewMenus.notStarted');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.NOT_STARTED}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-in-progress',
        get label() {
          return t('viewMenus.inProgress');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-in-review',
        get label() {
          return t('viewMenus.inReview');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.IN_REVIEW}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-completed',
        get label() {
          return t('viewMenus.completed');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.COMPLETED}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-canceled',
        get label() {
          return t('viewMenus.canceled');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.CANCELED}
            class="size-3.5"
          />
        ),
      },
    ],
    multiple: true,
  },
  {
    id: 'priority',
    get label() {
      return t('viewMenus.priority');
    },
    get labelPlural() {
      return t('viewMenus.priorities');
    },
    options: [
      {
        id: 'task-urgent',
        get label() {
          return t('viewMenus.urgent');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.PRIORITY.URGENT}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-high-priority',
        get label() {
          return t('viewMenus.highPriority');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.PRIORITY.HIGH}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-medium-priority',
        get label() {
          return t('viewMenus.mediumPriority');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.PRIORITY.MEDIUM}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-low-priority',
        get label() {
          return t('viewMenus.lowPriority');
        },
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.PRIORITY.LOW}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-no-priority',
        get label() {
          return t('viewMenus.noPriority');
        },
      },
    ],
    multiple: true,
  },
];

// The Customers view's Stage filter is context-driven (team-customizable
// stage set), rendered as a searchable submenu next to Owner — no static
// categories here.
const COMPANIES_FILTER_CATEGORIES: FilterCategory[] = [];

const DOCUMENTS_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'type',
    get label() {
      return t('viewMenus.type');
    },
    get labelPlural() {
      return t('viewMenus.types');
    },
    options: [
      {
        id: 'doc-markdown',
        label: 'Markdown',
        icon: () => <EntityIcon targetType="md" size="xs" />,
      },
      {
        id: 'doc-canvas',
        get label() {
          return t('viewMenus.canvas');
        },
        icon: () => <EntityIcon targetType="canvas" size="xs" />,
      },
      {
        id: 'doc-spreadsheet',
        get label() {
          return t('viewMenus.spreadsheet');
        },
        icon: () => <EntityIcon targetType="spreadsheet" size="xs" />,
      },
      {
        id: 'file-code',
        get label() {
          return t('viewMenus.code');
        },
        icon: () => <EntityIcon targetType="code" size="xs" />,
      },
      {
        id: 'file-image',
        get label() {
          return t('viewMenus.images');
        },
        icon: () => <EntityIcon targetType="image" size="xs" />,
      },
      {
        id: 'file-pdf',
        get label() {
          return t('viewMenus.pdfs');
        },
        icon: () => <EntityIcon targetType="pdf" size="xs" />,
      },
      {
        id: 'file-docx',
        label: 'DOCX',
        icon: () => <EntityIcon targetType="write" size="xs" />,
      },
      {
        id: 'file-video',
        get label() {
          return t('viewMenus.videos');
        },
        icon: () => <EntityIcon targetType="video" size="xs" />,
      },
      {
        id: 'doc-snippet',
        get label() {
          return t('viewMenus.snippets');
        },
        icon: () => <EntityIcon targetType="snippet" size="xs" />,
      },
      {
        id: 'doc-skill',
        get label() {
          return t('viewMenus.skills');
        },
        icon: () => <EntityIcon targetType="skill" size="xs" />,
      },
      {
        id: 'file-other',
        get label() {
          return t('viewMenus.other');
        },
        icon: () => <EntityIcon targetType="files" size="xs" />,
      },
    ],
    multiple: true,
  },
];

export function buildContactLabel(
  contact: { id: string; name?: string | null },
  currentUserId: string | undefined
): string {
  if (contact.id === currentUserId) {
    return contact.name
      ? t('viewMenus.contactMe', { name: contact.name })
      : t('viewMenus.me');
  }
  return contact.name || contact.id;
}

export const VIEW_FILTER_CATEGORIES: Record<ListView, FilterCategory[]> = {
  home: HOME_FILTER_CATEGORIES,
  // No refinements yet: the touched-by-me query rejects channel/email
  // filter trees, so the inbox categories can't be offered wholesale.
  recent: [],
  agents: [],
  mail: MAIL_FILTER_CATEGORIES,
  documents: DOCUMENTS_FILTER_CATEGORIES,
  tasks: TASKS_FILTER_CATEGORIES,
  companies: COMPANIES_FILTER_CATEGORIES,
  channels: [],
  calls: [],
  folders: [],
  search: [],
};

interface UnifiedFilterDropdownProps {
  /** View-specific refinements alongside the shared filters. */
  children?: JSX.Element;
  /** Optional controlled open state */
  open?: Accessor<boolean>;
  onOpenChange?: (open: boolean) => void;
  /** Optional custom trigger element. If not provided, uses default Filter button. */
  customTrigger?: JSX.Element;
  /** Hide the default trigger entirely (useful when controlling open state externally) */
  hideTrigger?: boolean;
  /** Hide the default trigger's text label while retaining its tooltip. */
  hideLabel?: boolean;
  variant?: ButtonVariant;
}

const READ_FILTER_OPTIONS: { id: ReadFilter; label: string }[] = [
  {
    id: 'unread',
    get label() {
      return t('viewMenus.unread');
    },
  },
  {
    id: 'read',
    get label() {
      return t('viewMenus.read');
    },
  },
  {
    id: 'all',
    get label() {
      return t('viewMenus.all');
    },
  },
];

/** Single-select read/unread/all submenu for the inbox. */
const ReadStatusSubmenu = (props: {
  value: ReadFilter;
  onChange: (value: ReadFilter) => void;
}) => {
  return (
    <FilterSubmenu
      label={t('viewMenus.status')}
      active={props.value !== 'all'}
      options={READ_FILTER_OPTIONS}
      isSelected={(id) => props.value === id}
      onSelect={props.onChange}
      closeOnSelect
    />
  );
};

export const UnifiedFilterDropdown = (
  props: UnifiedFilterDropdownProps = {}
) => {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const open = () => props.open?.() ?? internalOpen();
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    props.onOpenChange?.(v);
  };
  const panel = useSplitPanelOrThrow();
  const {
    soup,
    queryFilters,
    assigneeFilter,
    setAssigneeFilter,
    activeTab,
    readFilter,
    setReadFilter,
  } = useSoupView();
  const contacts = useContacts();
  const userId = useUserId();
  const selectFilters = useSoupView().extensions?.selectFilters ?? [];

  const currentView = createMemo((): ListView | undefined => {
    const content = panel.handle.content();
    if (content.type !== 'component' || !isListViewID(content.id))
      return undefined;
    return content.id;
  });

  const isHomeView = () => currentView() === 'home';
  const githubLinkStatus = useGithubLinkStatusQuery({
    enabled: () => currentView() === 'home',
  });

  const categories = createMemo(() => {
    const view = currentView();
    if (!view) return [];
    const viewCategories = VIEW_FILTER_CATEGORIES[view] ?? [];

    // The Folders tab only lists folders, so document-type refinements are
    // inapplicable there.
    if (view === 'documents' && activeTab() === 'folders') return [];

    if (view !== 'home') return viewCategories;

    return filterInboxGithubPrOption(
      viewCategories,
      githubLinkStatus.data?.status === 'linked'
    );
  });

  const isOptionActive = (optionId: string) => {
    return soup.predicates.isActive(optionId);
  };

  const toggleFilter = (optionId: string) => {
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

    if (currentView() === 'home' && isInboxTypeFilterId(optionId)) {
      const baseQuery = getViewPreset('home', activeTab())?.filters;

      if (!baseQuery) {
        return;
      }

      let nextQueryState = baseQuery;

      if (!wasActive) {
        nextQueryState = mergeQuery(
          queryStateFrom(baseQuery),
          defineQueryFilters({}, { skipTargetsFrom: query })
        );
      }

      queryFilters.replace(nextQueryState);

      return;
    }

    if (wasActive) {
      queryFilters.remove(query);
    } else {
      queryFilters.add(query);
    }
  };

  // Assignee options for tasks view
  const assigneeOptions = createMemo((): SearchableOption[] => {
    const currentUserId = userId();
    const noAssigneeOption: SearchableOption = {
      id: NO_ASSIGNEE,
      label: t('viewMenus.unassigned'),
      icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
    };
    let meOption: SearchableOption | undefined;
    const otherContactOptions: SearchableOption[] = [];
    for (const contact of contacts()) {
      const opt: SearchableOption = {
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

  const handleAssigneeChange = (ids: string[]) => {
    const current = assigneeFilter();
    const toAdd = ids.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !ids.includes(id));

    // Exclude NO_ASSIGNEE from backend queries - it's handled client-side only
    const toProps = (list: string[]): PropertyFilter[] =>
      list
        .filter((id) => id !== NO_ASSIGNEE)
        .map((id) => ({
          propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
          type: 'entity',
          value: id,
        }));

    batch(() => {
      setAssigneeFilter(ids);

      // Activate/deactivate the assignee predicate based on selection
      const shouldBeActive = ids.length > 0;
      if (shouldBeActive !== soup.predicates.isActive('assignee')) {
        soup.predicates.toggle({ and: ['assignee'] });
      }

      const removeProps = toProps(toRemove);
      const addProps = toProps(toAdd);
      if (removeProps.length)
        queryFilters.remove({ include: { properties: removeProps } });
      if (addProps.length)
        queryFilters.add({ include: { properties: addProps } });
    });
  };

  const isTasksView = () => currentView() === 'tasks';
  const isDocumentsView = () => currentView() === 'documents';
  const isCreatedByFilterView = () => {
    const view = currentView();
    return view === 'documents' || view === 'tasks';
  };
  const showCreatedByFilter = () =>
    isCreatedByFilterView() && !(isDocumentsView() && activeTab() === 'owned');

  // The Files "Owned" tab has a creator constraint as part of its base
  // preset. Keep that constraint when a user clears an explicit Created by
  // selection, rather than accidentally broadening the tab to every file.
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

  const createdByOptions = createMemo((): SearchableOption[] => {
    const currentUserId = userId();
    let meOption: SearchableOption | undefined;
    const otherContactOptions: SearchableOption[] = [];
    for (const contact of contacts()) {
      const opt: SearchableOption = {
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
    return [...(meOption ? [meOption] : []), ...otherContactOptions];
  });

  const handleCreatedByChange = (ids: string[]) => {
    const nextIds = ids.length > 0 ? ids : baseCreatedByIds();
    queryFilters.set({
      include: {
        documentOwnerId: nextIds.length > 0 ? nextIds : undefined,
      },
    });
  };

  const tagFilter = useTagFilter();
  const showTagsFilter = () => {
    const view = currentView();
    return tagFilter.hasTags() && !!view && TAGGABLE_LIST_VIEWS.has(view);
  };

  registerHotkey({
    hotkey: 'f',
    scopeId: panel.splitHotkeyScope,
    description: () => t('viewMenus.openFilterMenu'),
    hotkeyToken: TOKENS.soup.filter,
    keyDownHandler: () => {
      setOpen(true);
      return true;
    },
  });

  // Capture anchor position when menu opens to prevent jumping when chips are added
  const [anchorRect, setAnchorRect] = createSignal<DOMRect | null>(null);

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      // Clear any stale anchor rect so it gets recaptured from trigger
      setAnchorRect(null);
    }
    setOpen(isOpen);
  };

  const getAnchorRect = (anchor?: HTMLElement) => {
    // If we have a captured rect, use it (prevents jumping)
    const captured = anchorRect();
    if (captured) return captured;

    // Otherwise capture the current position
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setAnchorRect(rect);
      return rect;
    }
    return undefined;
  };

  return (
    <Show
      when={
        categories().length > 0 ||
        isTasksView() ||
        selectFilters.length > 0 ||
        isHomeView() ||
        showTagsFilter()
      }
    >
      <Dropdown
        open={open()}
        onOpenChange={handleOpenChange}
        getAnchorRect={getAnchorRect}
      >
        <Show when={!props.hideTrigger}>
          <Switch>
            <Match when={props.customTrigger}>{props.customTrigger}</Match>
            <Match when={true}>
              <Tooltip
                label={t('viewMenus.filter')}
                hotkey={TOKENS.soup.filter}
              >
                <Dropdown.Trigger
                  variant={props.variant ?? 'outline'}
                  depth={2}
                  class={props.variant === 'ghost' ? undefined : 'bg-surface'}
                  aria-label={
                    props.hideLabel ? t('viewMenus.filter') : undefined
                  }
                >
                  <FilterIcon />
                  <Show when={!props.hideLabel}>
                    <span>{t('viewMenus.filter')}</span>
                  </Show>
                </Dropdown.Trigger>
              </Tooltip>
            </Match>
          </Switch>
        </Show>

        <Dropdown.Content class={cn('min-w-32')}>
          <Dropdown.Group>
            <Show when={isHomeView()}>
              <ReadStatusSubmenu
                value={readFilter()}
                onChange={setReadFilter}
              />
            </Show>
            <Show
              when={
                categories().length === 1 &&
                !isDocumentsView() &&
                !isTasksView() &&
                selectFilters.length === 0 &&
                !isHomeView()
              }
              fallback={
                <>
                  <Show when={isDocumentsView() && showTagsFilter()}>
                    <SearchableFilterSubmenu
                      onSelectionComplete={() => setOpen(false)}
                      label={t('viewMenus.tags')}
                      options={tagFilter.options}
                      activeIds={tagFilter.activeIds}
                      onChange={tagFilter.onChange}
                      placeholder={t('viewMenus.filterByTag')}
                    />
                  </Show>

                  <For each={categories()}>
                    {(category) => (
                      <FilterSubmenu
                        label={category.label}
                        options={category.options}
                        isSelected={isOptionActive}
                        onSelect={toggleFilter}
                        closeOnSelect={
                          category.multiple ? 'unless-shift' : true
                        }
                      />
                    )}
                  </For>

                  {/* Assignee filter for tasks view */}
                  <Show when={isTasksView()}>
                    <SearchableFilterSubmenu
                      onSelectionComplete={() => setOpen(false)}
                      label={t('viewMenus.assignee')}
                      options={assigneeOptions}
                      activeIds={assigneeFilter}
                      onChange={handleAssigneeChange}
                      placeholder={t('viewMenus.searchAssignees')}
                    />
                  </Show>

                  <Show when={showCreatedByFilter()}>
                    <SearchableFilterSubmenu
                      onSelectionComplete={() => setOpen(false)}
                      label={t('viewMenus.createdBy')}
                      options={createdByOptions}
                      activeIds={createdByIds}
                      onChange={handleCreatedByChange}
                      placeholder={t('viewMenus.searchCreators')}
                    />
                  </Show>

                  <For each={selectFilters}>
                    {(filter) => (
                      <SearchableFilterSubmenu
                        onSelectionComplete={() => setOpen(false)}
                        label={filter.label}
                        active={filter.active?.()}
                        options={filter.options}
                        activeIds={filter.effectiveValues}
                        onChange={filter.change}
                        placeholder={filter.placeholder}
                        preserveOrder={filter.preserveOrder}
                      />
                    )}
                  </For>
                </>
              }
            >
              {/* Single category: render options directly */}
              <For each={categories()[0]!.options}>
                {(option) => {
                  const active = () => isOptionActive(option.id);
                  return (
                    <FilterOptionItem
                      label={option.label}
                      icon={option.icon}
                      active={active()}
                      onSelect={() => toggleFilter(option.id)}
                      closeOnSelect={
                        categories()[0]!.multiple ? 'unless-shift' : true
                      }
                    />
                  );
                }}
              </For>
            </Show>

            <Show when={!isDocumentsView() && showTagsFilter()}>
              <SearchableFilterSubmenu
                onSelectionComplete={() => setOpen(false)}
                label={t('viewMenus.tags')}
                options={tagFilter.options}
                activeIds={tagFilter.activeIds}
                onChange={tagFilter.onChange}
                placeholder={t('viewMenus.filterByTag')}
              />
            </Show>
            {props.children}
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
};
