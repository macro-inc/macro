import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { cn } from '@ui/utils/classname';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import SlidersHorizontalIcon from '@macro-icons/wide/sliders-horizontal.svg';
import CaretRightIcon from '@icon/regular/caret-right.svg';
import CheckIcon from '@icon/regular/check.svg';
import CircleDashedIcon from '@icon/regular/circle-dashed.svg';
import { SearchableMultiSelectInline } from './searchable-multi-select';
import { EntityIcon } from '@core/component/EntityIcon';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@core/component/Properties/constants';

import { useContacts } from '@queries/contacts/contacts';
import { useUserId } from '@core/context/user';
import { UserIcon } from '@core/component/UserIcon';
import type { FilterID } from '@app/component/next-soup/filters';
import { NO_ASSIGNEE } from '@app/component/next-soup/soup-view/task-sub-filter-matcher';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import {
  INDEX_OPTIONS,
  cacheChannelSubFilters,
  cacheEmailSubFilters,
  useSearchFilterOptions,
  useSearchIndexController,
  type ChannelSubFilters,
  type SearchableOption,
} from './search-filter-controls';

const TypeIndicator = (props: { active: boolean }) => (
  <span
    class={cn(
      'size-4 flex items-center justify-center shrink-0 rounded-full border transition-colors',
      props.active ? 'bg-accent border-accent' : 'border-edge'
    )}
  >
    <Show when={props.active}>
      <CheckIcon class="size-2.5 text-page" />
    </Show>
  </span>
);

export type FilterOption = {
  id: FilterID;
  label: string;
  icon?: () => JSX.Element;
};

export type FilterCategory = {
  id: string;
  label: string;
  options: FilterOption[];
  multiple?: boolean;
};

// Filter categories by view
const INBOX_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'type',
    label: 'Type',
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
        icon: () => <EntityIcon targetType="unknown" size="xs" />,
      },
    ],
    multiple: true,
  },
];

const MAIL_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'status',
    label: 'Status',
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
        icon: () => <EntityIcon targetType="unknown" size="xs" />,
      },
    ],
    multiple: true,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    options: [{ id: 'has-calendar-invite', label: 'Has Calendar Invite' }],
    multiple: false,
  },
];

const TASKS_FILTER_CATEGORIES: FilterCategory[] = [
  {
    id: 'status',
    label: 'Status',
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
    options: [
      {
        id: 'task-critical',
        label: 'Critical',
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
        id: 'file-other',
        label: 'Other',
        icon: () => <EntityIcon targetType="unknown" size="xs" />,
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
  let inputRef: HTMLInputElement | undefined;

  return (
    <DropdownMenu.Sub gutter={4} open={isOpen()} onOpenChange={setIsOpen}>
      <DropdownMenu.SubTrigger
        class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover"
        onPointerEnter={(e) => {
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
      </DropdownMenu.SubTrigger>

      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          class="z-action-menu bg-menu border border-edge-muted rounded-sm shadow-xl w-[260px] max-w-[90vw] overflow-hidden"
          onFocusIn={(e) => {
            // Kobalte focuses SubContent itself on open; redirect to the
            // search input so it gets focus deterministically.
            if (e.target === e.currentTarget && inputRef) {
              inputRef.focus();
            }
          }}
        >
          <SearchableMultiSelectInline
            options={props.options}
            activeIds={props.activeIds}
            onChange={props.onChange}
            placeholder={props.placeholder}
            inputRef={(el) => {
              inputRef = el;
            }}
            onRequestClose={() => setIsOpen(false)}
          />
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
};

export const UnifiedFilterDropdown = () => {
  const [open, setOpen] = createSignal(false);
  const panel = useSplitPanelOrThrow();
  const {
    soup,
    queryFilters,
    setQueryFilters,
    assigneeFilter,
    setAssigneeFilter,
  } = useSoupView();
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
    return soup.filters.isActive(optionId);
  };

  const toggleFilter = (optionId: string) => {
    soup.filters.toggle({ or: [optionId] });
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
            size="xs"
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

  const isTasksView = () => currentView() === 'tasks';
  const isSearchView = () => currentView() === 'search';
  const isChannelsIndexActive = () => soup.filters.isActive('channels');
  const isEmailIndexActive = () => soup.filters.isActive('email');
  const hasActiveIndex = () =>
    INDEX_OPTIONS.some((opt) => soup.filters.isActive(opt.value));

  const { changeIndex: handleIndexChange } = useSearchIndexController();

  createEffect(() => {
    if (!isSearchView() || !isChannelsIndexActive()) return;
    const cf = queryFilters().channel_filters;
    const sub: ChannelSubFilters = {};
    if (cf?.channel_ids?.length) sub.channel_ids = cf.channel_ids;
    if (cf?.sender_ids?.length) sub.sender_ids = cf.sender_ids;
    cacheChannelSubFilters(contentId, sub);
  });

  createEffect(() => {
    if (!isSearchView() || !isEmailIndexActive()) return;
    const ef = queryFilters().email_filters;
    cacheEmailSubFilters(contentId, { importance: ef?.importance ?? null });
  });

  const { channelOptions: inChannelOptions, senderOptions: fromSenderOptions } =
    useSearchFilterOptions();

  const activeChannelIds: Accessor<string[]> = createMemo(
    () => queryFilters().channel_filters?.channel_ids ?? []
  );

  const setChannelIds = (ids: string[]) => {
    batch(() => {
      if (!isChannelsIndexActive()) handleIndexChange('channels');
      setQueryFilters((prev) => ({
        ...prev,
        channel_filters: {
          ...prev.channel_filters,
          channel_ids: ids.length > 0 ? ids : undefined,
        },
      }));
    });
  };

  const activeSenderIds: Accessor<string[]> = createMemo(
    () => queryFilters().channel_filters?.sender_ids ?? []
  );

  const setSenderIds = (ids: string[]) => {
    batch(() => {
      if (!isChannelsIndexActive()) handleIndexChange('channels');
      setQueryFilters((prev) => ({
        ...prev,
        channel_filters: {
          ...prev.channel_filters,
          sender_ids: ids.length > 0 ? ids : undefined,
        },
      }));
    });
  };

  const setImportance = (val: boolean | undefined) => {
    batch(() => {
      if (!isEmailIndexActive()) handleIndexChange('email');
      setQueryFilters((prev) => ({
        ...prev,
        email_filters: { ...prev.email_filters, importance: val },
      }));
    });
  };

  const importance = createMemo(() => queryFilters().email_filters?.importance);

  const [openChannelSub, setOpenChannelSub] = createSignal<
    'in' | 'from' | null
  >(null);

  registerHotkey({
    hotkey: 'f',
    scopeId: panel.splitHotkeyScope,
    description: 'Open filter menu',
    keyDownHandler: () => {
      setOpen(true);
      return true;
    },
  });

  return (
    <Show when={categories().length > 0 || isTasksView() || isSearchView()}>
      <DropdownMenu open={open()} onOpenChange={setOpen}>
        <Tooltip tooltip={<LabelAndHotKey label="Filter" shortcut="F" />}>
          <DropdownMenu.Trigger
            as={Button}
            variant="secondary"
            size="sm"
            class="rounded-xs [&_svg]:size-4"
          >
            <SlidersHorizontalIcon />
            <span class="font-medium">Filter</span>
          </DropdownMenu.Trigger>
        </Tooltip>

        <DropdownMenu.Portal>
          <DropdownMenu.Content class="z-action-menu bg-menu border border-edge-muted rounded-sm shadow-xl min-w-[180px] p-1">
            <Show
              when={
                categories().length === 1 && !isTasksView() && !isSearchView()
              }
              fallback={
                <>
                  <For each={categories()}>
                    {(category) => (
                      <DropdownMenu.Sub gutter={4}>
                        <DropdownMenu.SubTrigger class="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover">
                          <span class="text-ink">{category.label}</span>
                          <CaretRightIcon class="size-3 text-ink-muted" />
                        </DropdownMenu.SubTrigger>

                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent class="z-action-menu bg-menu border border-edge-muted rounded-sm shadow-xl min-w-[160px] p-1">
                            <For each={category.options}>
                              {(option) => {
                                const active = () => isOptionActive(option.id);
                                return (
                                  <DropdownMenu.Item
                                    class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover cursor-pointer"
                                    onSelect={() => toggleFilter(option.id)}
                                    closeOnSelect={!category.multiple}
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

                                    <span
                                      class={cn(
                                        'flex-1 truncate',
                                        active() ? 'text-ink' : 'text-ink-muted'
                                      )}
                                    >
                                      {option.label}
                                    </span>
                                  </DropdownMenu.Item>
                                );
                              }}
                            </For>
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                    )}
                  </For>

                  {/* Assignee filter for tasks view */}
                  <Show when={isTasksView()}>
                    <SearchableFilterSubmenu
                      label="Assignee"
                      options={assigneeOptions}
                      activeIds={assigneeFilter}
                      onChange={setAssigneeFilter}
                      placeholder="Search assignees..."
                    />
                  </Show>

                  {/* Search view: 7 type rows (Channels/Email have nested submenus) */}
                  <Show when={isSearchView()}>
                    <For each={INDEX_OPTIONS}>
                      {(option) => {
                        const active = () =>
                          soup.filters.isActive(option.value);
                        const hasSub =
                          option.value === 'channels' ||
                          option.value === 'email';
                        return (
                          <Show
                            when={hasSub}
                            fallback={
                              <DropdownMenu.Item
                                class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover"
                                onSelect={() => handleIndexChange(option.value)}
                                closeOnSelect
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
                              </DropdownMenu.Item>
                            }
                          >
                            <DropdownMenu.Sub gutter={4}>
                              <DropdownMenu.SubTrigger
                                class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover"
                                onPointerDown={() =>
                                  handleIndexChange(option.value)
                                }
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
                                <CaretRightIcon class="size-3 text-ink-muted" />
                              </DropdownMenu.SubTrigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.SubContent class="z-action-menu bg-menu border border-edge-muted rounded-sm shadow-xl min-w-[180px] p-1">
                                  <Show when={option.value === 'channels'}>
                                    <SearchableFilterSubmenu
                                      label="In"
                                      options={inChannelOptions}
                                      activeIds={activeChannelIds}
                                      onChange={setChannelIds}
                                      placeholder="Search channels..."
                                      open={() => openChannelSub() === 'in'}
                                      onOpenChange={(v) =>
                                        setOpenChannelSub(v ? 'in' : null)
                                      }
                                    />
                                    <SearchableFilterSubmenu
                                      label="From"
                                      options={fromSenderOptions}
                                      activeIds={activeSenderIds}
                                      onChange={setSenderIds}
                                      placeholder="Search senders..."
                                      open={() => openChannelSub() === 'from'}
                                      onOpenChange={(v) =>
                                        setOpenChannelSub(v ? 'from' : null)
                                      }
                                    />
                                  </Show>
                                  <Show when={option.value === 'email'}>
                                    <DropdownMenu.Sub gutter={4}>
                                      <DropdownMenu.SubTrigger class="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover">
                                        <span class="text-ink">Importance</span>
                                        <CaretRightIcon class="size-3 text-ink-muted" />
                                      </DropdownMenu.SubTrigger>
                                      <DropdownMenu.Portal>
                                        <DropdownMenu.SubContent class="z-action-menu bg-menu border border-edge-muted rounded-sm shadow-xl min-w-[160px] p-1">
                                          <For
                                            each={[
                                              {
                                                label: 'Signal',
                                                value: true as
                                                  | boolean
                                                  | undefined,
                                              },
                                              {
                                                label: 'Noise',
                                                value: false as
                                                  | boolean
                                                  | undefined,
                                              },
                                              {
                                                label: 'All',
                                                value: undefined as
                                                  | boolean
                                                  | undefined,
                                              },
                                            ]}
                                          >
                                            {(importanceOption) => {
                                              const importanceActive = () =>
                                                importance() ===
                                                importanceOption.value;
                                              return (
                                                <DropdownMenu.Item
                                                  class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover"
                                                  onSelect={() =>
                                                    setImportance(
                                                      importanceOption.value
                                                    )
                                                  }
                                                  closeOnSelect
                                                >
                                                  <TypeIndicator
                                                    active={importanceActive()}
                                                  />
                                                  <span
                                                    class={cn(
                                                      'flex-1 truncate',
                                                      importanceActive()
                                                        ? 'text-ink'
                                                        : 'text-ink-muted'
                                                    )}
                                                  >
                                                    {importanceOption.label}
                                                  </span>
                                                </DropdownMenu.Item>
                                              );
                                            }}
                                          </For>
                                        </DropdownMenu.SubContent>
                                      </DropdownMenu.Portal>
                                    </DropdownMenu.Sub>
                                  </Show>
                                </DropdownMenu.SubContent>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Sub>
                          </Show>
                        );
                      }}
                    </For>

                    {/* All row */}
                    <DropdownMenu.Item
                      class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover"
                      onSelect={() => handleIndexChange('all')}
                      closeOnSelect
                    >
                      <TypeIndicator active={!hasActiveIndex()} />
                      <span
                        class={cn(
                          'flex-1 truncate',
                          !hasActiveIndex() ? 'text-ink' : 'text-ink-muted'
                        )}
                      >
                        All
                      </span>
                    </DropdownMenu.Item>
                  </Show>
                </>
              }
            >
              {/* Single category: render options directly */}
              <For each={categories()[0]!.options}>
                {(option) => {
                  const active = () => isOptionActive(option.id);
                  return (
                    <DropdownMenu.Item
                      class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover cursor-pointer"
                      onSelect={() => toggleFilter(option.id)}
                      closeOnSelect={!categories()[0]!.multiple}
                    >
                      <span
                        class={cn(
                          'size-4 flex items-center justify-center shrink-0 rounded border transition-colors',
                          active() ? 'bg-accent border-accent' : 'border-edge'
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

                      <span
                        class={cn(
                          'flex-1 truncate',
                          active() ? 'text-ink' : 'text-ink-muted'
                        )}
                      >
                        {option.label}
                      </span>
                    </DropdownMenu.Item>
                  );
                }}
              </For>
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  );
};
