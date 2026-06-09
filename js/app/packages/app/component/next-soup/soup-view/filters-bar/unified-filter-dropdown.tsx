import { getViewPreset } from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters';
import {
  type FilterContext,
  NO_ASSIGNEE,
} from '@app/component/next-soup/filters/configs/';
import {
  defineQueryFilters,
  type PropertyFilter,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
import { mergeQuery } from '@app/component/next-soup/filters/filter-store/query-store';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import CircleDashedIcon from '@phosphor/circle-dashed.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useContacts } from '@queries/contacts/contacts';
import { cn, Dropdown, SingleSelectCheck, Tooltip } from '@ui';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import {
  CALL_STATUS_OPTIONS,
  INDEX_OPTIONS,
  type SearchableOption,
  useCallSearchFilter,
  useChannelSearchFilter,
  useEmailSearchFilter,
  useSearchFilterOptions,
  useSearchIndexController,
} from './search-filter-controls';
import { SearchableMultiSelectInline } from './searchable-multi-select';

export const TypeIndicator = (props: { active: boolean }) => (
  <span
    class={cn(
      'size-3.5 flex items-center justify-center shrink-0 rounded-sm border text-surface',
      props.active
        ? 'bg-accent border-accent'
        : 'border-transparent group-hover:not-hover:border-edge-muted group-data-highlighted:not-hover:border-edge-muted hover:border-accent'
    )}
  >
    <Show when={props.active}>
      <CheckIcon class="size-2.5" />
    </Show>
  </span>
);

// Sub-trigger rows differ from default Dropdown.Item only by
// distributing label + caret to the row ends.
// const FILTER_MENU_SUBTRIGGER_CLASS = 'justify-between gap-2';

export type FilterOption = {
  id: FilterID;
  label: string;
  icon?: () => JSX.Element;
};

type FilterCategory = {
  id: string;
  label: string;
  /** Plural form for multi-value chip display (e.g., 'Types', 'Statuses') */
  labelPlural?: string;
  options: FilterOption[];
  multiple?: boolean;
};

// Filter categories by view
const INBOX_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'type',
    label: 'Type',
    labelPlural: 'Types',
    options: [
      {
        id: 'document',
        label: 'Docs',
        icon: () => <EntityIcon targetType="md" size="xs" />,
      },
      {
        id: 'agent',
        label: 'Agents',
        icon: () => <EntityIcon targetType="chat" size="xs" />,
      },
      {
        id: 'people',
        label: 'People',
        icon: () => <EntityIcon targetType="direct_message" size="xs" />,
      },
      {
        id: 'teams',
        label: 'Teams',
        icon: () => <EntityIcon targetType="channel" size="xs" />,
      },
      {
        id: 'task',
        label: 'Tasks',
        icon: () => <EntityIcon targetType="task" size="xs" />,
      },
      {
        id: 'email',
        label: 'Mail',
        icon: () => <EntityIcon targetType="email" size="xs" />,
      },
      {
        id: 'file',
        label: 'Files',
        icon: () => <EntityIcon targetType="files" size="xs" />,
      },
    ],
    multiple: true,
  },
];

const isInboxTypeFilterId = (id: string) => {
  for (const category of INBOX_FILTER_CATEGORIES) {
    if (category.options.find((o) => o.id === id)) return true;
  }

  return false;
};

const MAIL_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'status',
    label: 'Status',
    labelPlural: 'Statuses',
    options: [
      { id: 'unread', label: 'Unread' },
      { id: 'read', label: 'Read' },
      { id: 'not-done', label: 'Not Done' },
      { id: 'done', label: 'Done' },
    ],
    multiple: true,
  },
  {
    id: 'attachment',
    label: 'Attachments',
    labelPlural: 'Attachments',
    options: [
      {
        id: 'attachment-pdf',
        label: 'PDFs',
        icon: () => <EntityIcon targetType="pdf" size="xs" />,
      },
      {
        id: 'attachment-image',
        label: 'Images',
        icon: () => <EntityIcon targetType="image" size="xs" />,
      },
      {
        id: 'attachment-document',
        label: 'Documents',
        icon: () => <EntityIcon targetType="files" size="xs" />,
      },
    ],
    multiple: true,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    labelPlural: 'Calendar',
    options: [{ id: 'has-calendar-invite', label: 'Has Calendar Invite' }],
    multiple: false,
  },
];

const TASKS_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'status',
    label: 'Status',
    labelPlural: 'Statuses',
    options: [
      {
        id: 'task-not-started',
        label: 'Not Started',
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.NOT_STARTED}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-in-progress',
        label: 'In Progress',
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-in-review',
        label: 'In Review',
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.IN_REVIEW}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-completed',
        label: 'Completed',
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.STATUS.COMPLETED}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-canceled',
        label: 'Canceled',
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
    label: 'Priority',
    labelPlural: 'Priorities',
    options: [
      {
        id: 'task-urgent',
        label: 'Urgent',
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.PRIORITY.URGENT}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-high-priority',
        label: 'High Priority',
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.PRIORITY.HIGH}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-medium-priority',
        label: 'Medium Priority',
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.PRIORITY.MEDIUM}
            class="size-3.5"
          />
        ),
      },
      {
        id: 'task-low-priority',
        label: 'Low Priority',
        icon: () => (
          <PropertyValueIcon
            optionId={PROPERTY_OPTION_IDS.PRIORITY.LOW}
            class="size-3.5"
          />
        ),
      },
      { id: 'task-no-priority', label: 'No Priority' },
    ],
    multiple: true,
  },
];

const DOCUMENTS_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'type',
    label: 'Type',
    labelPlural: 'Types',
    options: [
      {
        id: 'doc-markdown',
        label: 'Markdown',
        icon: () => <EntityIcon targetType="md" size="xs" />,
      },
      {
        id: 'doc-canvas',
        label: 'Canvas',
        icon: () => <EntityIcon targetType="canvas" size="xs" />,
      },
      {
        id: 'file-code',
        label: 'Code',
        icon: () => <EntityIcon targetType="code" size="xs" />,
      },
      {
        id: 'file-image',
        label: 'Images',
        icon: () => <EntityIcon targetType="image" size="xs" />,
      },
      {
        id: 'file-pdf',
        label: 'PDFs',
        icon: () => <EntityIcon targetType="pdf" size="xs" />,
      },
      {
        id: 'file-docx',
        label: 'DOCX',
        icon: () => <EntityIcon targetType="write" size="xs" />,
      },
      {
        id: 'file-video',
        label: 'Videos',
        icon: () => <EntityIcon targetType="video" size="xs" />,
      },
      {
        id: 'file-other',
        label: 'Other',
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
    return contact.name ? `${contact.name} (me)` : 'Me';
  }
  return contact.name || contact.id;
}

export const VIEW_FILTER_CATEGORIES: Record<ListView, FilterCategory[]> = {
  inbox: INBOX_FILTER_CATEGORIES,
  agents: [],
  mail: MAIL_FILTER_CATEGORIES,
  documents: DOCUMENTS_FILTER_CATEGORIES,
  tasks: TASKS_FILTER_CATEGORIES,
  channels: [],
  calls: [],
  folders: [],
  search: [],
};

/** Searchable submenu for filters with many options like assignees */
const SearchableFilterSubmenu = (props: {
  label: string;
  options: Accessor<SearchableOption[]>;
  activeIds: Accessor<string[]>;
  onChange: (ids: string[]) => void;
  placeholder?: string;
  open?: Accessor<boolean>;
  onOpenChange?: (v: boolean) => void;
}) => {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const isOpen = () => props.open?.() ?? internalOpen();
  const setIsOpen = (v: boolean) => {
    if (props.onOpenChange) props.onOpenChange(v);
    else setInternalOpen(v);
  };
  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();

  // Focus the search input while the sub is open.
  //
  // Two issues conspire:
  //   1. Initial focus has to wait for Kobalte's DismissableLayer to register
  //      itself as a nested layer of the parent menu (done in its onMount).
  //      The sub is portaled, so focusing the input before that registration
  //      looks like "focus outside" to the parent and closes the whole menu
  //      tree. One rAF is enough to get past those onMount callbacks.
  //   2. After that, Kobalte's `onPointerMove` on the SubTrigger keeps
  //      calling `focusWithoutScrolling(e.currentTarget)` on every mouse
  //      move, stealing focus back to the trigger. Reclaim on blur — user
  //      dismissal routes (Escape / click-outside) close the sub first,
  //      which unregisters this listener before focus moves elsewhere.
  createEffect(() => {
    const el = inputRef();
    if (!isOpen() || !el) return;

    const raf = requestAnimationFrame(() => {
      if (isOpen()) el.focus();
    });

    const onBlur = () => {
      queueMicrotask(() => {
        if (isOpen() && document.activeElement !== el) el.focus();
      });
    };
    el.addEventListener('blur', onBlur);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      el.removeEventListener('blur', onBlur);
    });
  });

  return (
    <Dropdown.Sub open={isOpen()} onOpenChange={setIsOpen}>
      <Dropdown.SubTrigger
        onPointerEnter={(e: PointerEvent & { currentTarget: HTMLElement }) => {
          // Kobalte's "grace polygon" keeps an open sub alive when the
          // pointer crosses toward its content. For sibling In/From triggers,
          // that means moving between them leaves the prior sub stuck open
          // and the prior trigger stuck with data-highlighted. Force focus
          // + open so Kobalte's parent selection manager updates to this
          // trigger and the shared signal closes the sibling.
          if (e.pointerType !== 'mouse') return;
          e.currentTarget.focus({ preventScroll: true });
          if (!isOpen()) setIsOpen(true);
        }}
      >
        <span class="text-ink">{props.label}</span>
        <CaretRightIcon class="size-3 text-ink-muted" />
      </Dropdown.SubTrigger>

      <Dropdown.SubContent class="w-65 max-w-[90vw]">
        <Dropdown.Group class="p-0 gap-0">
          <SearchableMultiSelectInline
            onRequestClose={() => setIsOpen(false)}
            placeholder={props.placeholder}
            activeIds={props.activeIds}
            onChange={props.onChange}
            options={props.options}
            inputRef={setInputRef}
          />
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
};

/** Single-value sub-menu (e.g. Importance, Status). */
function SingleValueSubmenu<T>(props: {
  label: string;
  options: { label: string; value: T }[];
  current: Accessor<T>;
  onSelect: (value: T) => void;
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger>
        <span class="text-ink">{props.label}</span>
        <CaretRightIcon class="size-3 text-ink-muted" />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent>
        <Dropdown.Group>
          <For each={props.options}>
            {(option) => {
              const active = () => props.current() === option.value;
              return (
                <Dropdown.Item
                  onSelect={() => props.onSelect(option.value)}
                  closeOnSelect
                >
                  <span class="flex-1 truncate">{option.label}</span>
                  <SingleSelectCheck active={active()} />
                </Dropdown.Item>
              );
            }}
          </For>
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}

type InFromOpen = 'in' | 'from' | null;

/** In + From (channel messages). */
const ChannelSearchSubContent = (props: {
  channel: ReturnType<typeof useChannelSearchFilter>;
  channelOptions: Accessor<SearchableOption[]>;
  senderOptions: Accessor<SearchableOption[]>;
}) => {
  const [openSub, setOpenSub] = createSignal<InFromOpen>(null);
  return (
    <>
      <SearchableFilterSubmenu
        label="In"
        options={props.channelOptions}
        activeIds={props.channel.channelIds}
        onChange={props.channel.setChannelIds}
        placeholder="Search channels..."
        open={() => openSub() === 'in'}
        onOpenChange={(v) => setOpenSub(v ? 'in' : null)}
      />
      <SearchableFilterSubmenu
        label="From"
        options={props.senderOptions}
        activeIds={props.channel.senderIds}
        onChange={props.channel.setSenderIds}
        placeholder="Search senders..."
        open={() => openSub() === 'from'}
        onOpenChange={(v) => setOpenSub(v ? 'from' : null)}
      />
    </>
  );
};

const IMPORTANCE_OPTIONS: {
  label: string;
  value: boolean | undefined;
}[] = [
  { label: 'Signal', value: true },
  { label: 'Noise', value: false },
  { label: 'All', value: undefined },
];

/** Importance (emails). */
const EmailSearchSubContent = (props: {
  email: ReturnType<typeof useEmailSearchFilter>;
}) => (
  <SingleValueSubmenu
    label="Importance"
    options={IMPORTANCE_OPTIONS}
    current={props.email.importance}
    onSelect={props.email.setImportance}
  />
);

/** In + From + Status (calls). */
const CallSearchSubContent = (props: {
  call: ReturnType<typeof useCallSearchFilter>;
  channelOptions: Accessor<SearchableOption[]>;
  senderOptions: Accessor<SearchableOption[]>;
}) => {
  const [openSub, setOpenSub] = createSignal<InFromOpen>(null);
  return (
    <>
      <SearchableFilterSubmenu
        label="In"
        options={props.channelOptions}
        activeIds={props.call.channelIds}
        onChange={props.call.setChannelIds}
        placeholder="Search channels..."
        open={() => openSub() === 'in'}
        onOpenChange={(v) => setOpenSub(v ? 'in' : null)}
      />
      <SearchableFilterSubmenu
        label="From"
        options={props.senderOptions}
        activeIds={props.call.speakerIds}
        onChange={props.call.setSpeakerIds}
        placeholder="Search speakers..."
        open={() => openSub() === 'from'}
        onOpenChange={(v) => setOpenSub(v ? 'from' : null)}
      />
      <SingleValueSubmenu
        label="Status"
        options={CALL_STATUS_OPTIONS}
        current={() => props.call.status() ?? undefined}
        onSelect={props.call.setStatus}
      />
    </>
  );
};

const SearchIndexRowLabel = (props: {
  option: (typeof INDEX_OPTIONS)[number];
  active: Accessor<boolean>;
}) => (
  <>
    <Show when={props.option.icon}>
      {(icon) => (
        <span class="size-4 flex items-center justify-center shrink-0">
          {icon()()}
        </span>
      )}
    </Show>
    <span class="flex-1 truncate">{props.option.label}</span>
    <SingleSelectCheck active={props.active()} />
  </>
);

/** Flat row — selecting it just switches the active index. */
const SearchIndexItem = (props: {
  option: (typeof INDEX_OPTIONS)[number];
  active: Accessor<boolean>;
  onSelect: () => void;
}) => (
  <Dropdown.Item onSelect={props.onSelect} closeOnSelect>
    <SearchIndexRowLabel option={props.option} active={props.active} />
  </Dropdown.Item>
);

/** Row with a nested submenu.
 *
 * `children` must be lazy (via `<Match>`) so the nested submenus
 * instantiate *inside* this row's `Dropdown.SubContent`. Eager JSX
 * would evaluate in the outer content's context, which makes Kobalte
 * register nested `Dropdown.Sub`s against the wrong parent —
 * positioning falls back to the viewport and keyboard nav treats them as
 * siblings of the row. */
const SearchIndexSubRow = (props: {
  option: (typeof INDEX_OPTIONS)[number];
  active: Accessor<boolean>;
  onSelect: () => void;
  closeRoot: () => void;
  children: JSX.Element;
}) => (
  <Dropdown.Sub>
    <Dropdown.SubTrigger
      onPointerDown={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          props.onSelect();
          props.closeRoot();
        }
      }}
    >
      <SearchIndexRowLabel option={props.option} active={props.active} />
      <CaretRightIcon class="size-3 text-ink-muted" />
    </Dropdown.SubTrigger>
    <Dropdown.SubContent>
      <Dropdown.Group>{props.children}</Dropdown.Group>
    </Dropdown.SubContent>
  </Dropdown.Sub>
);

interface UnifiedFilterDropdownProps {
  /** Optional controlled open state */
  open?: Accessor<boolean>;
  onOpenChange?: (open: boolean) => void;
  /** Optional custom trigger element. If not provided, uses default Filter button. */
  customTrigger?: JSX.Element;
  /** Hide the default trigger entirely (useful when controlling open state externally) */
  hideTrigger?: boolean;
}

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
  const { soup, queryFilters, assigneeFilter, setAssigneeFilter, activeTab } =
    useSoupView();
  const contacts = useContacts();
  const userId = useUserId();
  const contentId = panel.handle.content().id;

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

  const isOptionActive = (optionId: string) => {
    return soup.predicates.isActive(optionId);
  };

  const toggleFilter = (optionId: string) => {
    const wasActive = soup.predicates.isActive(optionId);
    soup.predicates.toggle({ or: [optionId] });

    const filter = soup.predicates.getConfig(optionId);
    if (!filter?.query) return;

    const ctx: FilterContext = {
      userId: userId(),
      assignees: assigneeFilter(),
    };
    const query =
      typeof filter.query === 'function' ? filter.query(ctx) : filter.query;

    if (currentView() === 'inbox' && isInboxTypeFilterId(optionId)) {
      const baseQuery = getViewPreset('inbox', activeTab())?.filters;

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
      label: 'Unassigned',
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
  const isSearchView = () => currentView() === 'search';
  const hasActiveIndex = () =>
    INDEX_OPTIONS.some((opt) => soup.predicates.isActive(opt.value));

  const { changeIndex: handleIndexChange } = useSearchIndexController();

  const channel = useChannelSearchFilter({ contentId, isSearchView });
  const email = useEmailSearchFilter({ contentId, isSearchView });
  const call = useCallSearchFilter({ contentId, isSearchView });

  const { channelOptions: inChannelOptions, senderOptions: fromSenderOptions } =
    useSearchFilterOptions();

  registerHotkey({
    hotkey: 'f',
    scopeId: panel.splitHotkeyScope,
    description: 'Open filter menu',
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
    <Show when={categories().length > 0 || isTasksView() || isSearchView()}>
      <Dropdown
        open={open()}
        onOpenChange={handleOpenChange}
        getAnchorRect={getAnchorRect}
      >
        <Show when={!props.hideTrigger}>
          <Switch>
            <Match when={props.customTrigger}>{props.customTrigger}</Match>
            <Match when={true}>
              <Tooltip label="Filter" hotkey={TOKENS.soup.filter}>
                <Dropdown.Trigger depth={2} class="bg-surface">
                  <FilterIcon />
                  <span>Filter</span>
                </Dropdown.Trigger>
              </Tooltip>
            </Match>
          </Switch>
        </Show>

        <Dropdown.Content>
          <Dropdown.Group>
            <Show
              when={
                categories().length === 1 && !isTasksView() && !isSearchView()
              }
              fallback={
                <>
                  <For each={categories()}>
                    {(category) => (
                      <Dropdown.Sub>
                        <Dropdown.SubTrigger>
                          <span class="text-ink">{category.label}</span>
                          <CaretRightIcon class="size-3 text-ink-muted" />
                        </Dropdown.SubTrigger>

                        <Dropdown.SubContent>
                          <Dropdown.Group>
                            <For each={category.options}>
                              {(option) => {
                                const active = () => isOptionActive(option.id);
                                return (
                                  <Dropdown.Item
                                    onSelect={() => toggleFilter(option.id)}
                                    closeOnSelect={!category.multiple}
                                  >
                                    <TypeIndicator active={active()} />

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
                                  </Dropdown.Item>
                                );
                              }}
                            </For>
                          </Dropdown.Group>
                        </Dropdown.SubContent>
                      </Dropdown.Sub>
                    )}
                  </For>

                  {/* Assignee filter for tasks view */}
                  <Show when={isTasksView()}>
                    <SearchableFilterSubmenu
                      label="Assignee"
                      options={assigneeOptions}
                      activeIds={assigneeFilter}
                      onChange={handleAssigneeChange}
                      placeholder="Search assignees..."
                    />
                  </Show>

                  {/* Search view: 7 type rows (Channels/Email have nested submenus) */}
                  <Show when={isSearchView()}>
                    <For each={INDEX_OPTIONS}>
                      {(option) => {
                        const rowProps = {
                          option,
                          active: () => soup.predicates.isActive(option.value),
                          onSelect: () => handleIndexChange(option.value),
                          closeRoot: () => setOpen(false),
                        };
                        return (
                          <Switch fallback={<SearchIndexItem {...rowProps} />}>
                            <Match when={option.value === 'channels'}>
                              <SearchIndexSubRow {...rowProps}>
                                <ChannelSearchSubContent
                                  channel={channel}
                                  channelOptions={inChannelOptions}
                                  senderOptions={fromSenderOptions}
                                />
                              </SearchIndexSubRow>
                            </Match>
                            <Match when={option.value === 'email'}>
                              <SearchIndexSubRow {...rowProps}>
                                <EmailSearchSubContent email={email} />
                              </SearchIndexSubRow>
                            </Match>
                            <Match when={option.value === 'calls'}>
                              <SearchIndexSubRow {...rowProps}>
                                <CallSearchSubContent
                                  call={call}
                                  channelOptions={inChannelOptions}
                                  senderOptions={fromSenderOptions}
                                />
                              </SearchIndexSubRow>
                            </Match>
                          </Switch>
                        );
                      }}
                    </For>

                    {/* All row */}
                    <Dropdown.Item
                      onSelect={() => handleIndexChange('all')}
                      closeOnSelect
                    >
                      <span class="flex-1 truncate">All</span>
                      <SingleSelectCheck active={!hasActiveIndex()} />
                    </Dropdown.Item>
                  </Show>
                </>
              }
            >
              {/* Single category: render options directly */}
              <For each={categories()[0]!.options}>
                {(option) => {
                  const active = () => isOptionActive(option.id);
                  return (
                    <Dropdown.Item
                      onSelect={() => toggleFilter(option.id)}
                      closeOnSelect={!categories()[0]!.multiple}
                    >
                      <TypeIndicator active={active()} />

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
                    </Dropdown.Item>
                  );
                }}
              </For>
            </Show>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
};
