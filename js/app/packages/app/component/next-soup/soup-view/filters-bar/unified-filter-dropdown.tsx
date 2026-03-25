import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { cn } from '@ui/utils/classname';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import SlidersHorizontalIcon from '@macro-icons/wide/sliders-horizontal.svg';
import CaretRightIcon from '@icon/regular/caret-right.svg';
import CheckIcon from '@icon/regular/check.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import CircleDashedIcon from '@icon/regular/circle-dashed.svg';
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

export type FilterOption = {
  id: string;
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
  folders: [],
  search: [],
};

/** Searchable submenu for filters with many options like assignees */
const SearchableFilterSubmenu = (props: {
  label: string;
  options: Accessor<FilterOption[]>;
  activeIds: Accessor<string[]>;
  onToggle: (id: string) => void;
  placeholder?: string;
  multiple?: boolean;
}) => {
  const [search, setSearch] = createSignal('');
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const filteredOptions = createMemo(() => {
    const query = search().toLowerCase();
    if (!query) return props.options();
    return props.options().filter((o) => o.label.toLowerCase().includes(query));
  });

  const isActive = (id: string) => props.activeIds().includes(id);

  const [isOpen, setIsOpen] = createSignal(false);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) return;
    setSearch('');
    setHighlightedIndex(0);
    // Double rAF to run after Kobalte finishes its own focus management
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inputRef?.focus();
      });
    });
  };

  const handleSubContentFocusOut = (e: FocusEvent) => {
    const subContentEl = e.currentTarget as HTMLElement;
    // If focus leaves SubContent while sub is still open (e.g. Kobalte focusing
    // the SubTrigger on hover), refocus the input
    if (isOpen() && !subContentEl.contains(e.relatedTarget as Node)) {
      requestAnimationFrame(() => {
        if (isOpen()) inputRef?.focus();
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const options = filteredOptions();
    const maxIndex = options.length - 1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, maxIndex));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        const option = options[highlightedIndex()];
        if (option) {
          props.onToggle(option.id);
        }
        break;
      case 'ArrowLeft':
        if (search() === '') {
          e.preventDefault();
          setIsOpen(false);
        }
        break;
      default:
        // Stop propagation for other keys to prevent Kobalte typeahead
        e.stopPropagation();
    }
  };

  return (
    <DropdownMenu.Sub
      gutter={4}
      open={isOpen()}
      onOpenChange={handleOpenChange}
    >
      <DropdownMenu.SubTrigger class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xs text-left text-xs transition-colors hover:bg-hover outline-none data-[highlighted]:bg-hover">
        <span class="text-ink">{props.label}</span>
        <CaretRightIcon class="size-3 text-ink-muted" />
      </DropdownMenu.SubTrigger>

      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          class="z-action-menu bg-menu border border-edge-muted rounded-sm shadow-xl min-w-[200px] p-1"
          onFocusOut={handleSubContentFocusOut}
        >
          {/* Search input */}
          <div class="flex items-center gap-2 px-2 py-2 border-b border-edge-muted mb-2">
            <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search()}
              onInput={(e) => {
                setSearch(e.currentTarget.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={props.placeholder ?? 'Search...'}
              class="flex-1 bg-transparent text-xs outline-none placeholder:text-ink-muted"
            />
          </div>

          {/* Options list */}
          <div class="max-h-48 overflow-y-auto">
            <For each={filteredOptions()}>
              {(option, index) => {
                const active = () => isActive(option.id);
                const highlighted = () => highlightedIndex() === index();
                return (
                  <button
                    type="button"
                    class={cn(
                      'w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xs text-left text-xs transition-colors',
                      highlighted() ? 'bg-hover' : 'hover:bg-hover'
                    )}
                    onClick={() => props.onToggle(option.id)}
                    onMouseEnter={() => setHighlightedIndex(index())}
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
                  </button>
                );
              }}
            </For>

            <Show when={filteredOptions().length === 0}>
              <div class="px-3 py-2 text-xs text-ink-muted">No results</div>
            </Show>
          </div>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
};

export const UnifiedFilterDropdown = () => {
  const [open, setOpen] = createSignal(false);
  const panel = useSplitPanelOrThrow();
  const { soup, assigneeFilter, setAssigneeFilter } = useSoupView();
  const contacts = useContacts();
  const userId = useUserId();

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
    soup.filters.toggle({ or: [optionId as FilterID] });
  };

  // Assignee options for tasks view
  const assigneeOptions = createMemo((): FilterOption[] => {
    const currentUserId = userId();
    const noAssigneeOption: FilterOption = {
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

  const toggleAssignee = (id: string) => {
    const current = assigneeFilter();
    if (current.includes(id)) {
      setAssigneeFilter(current.filter((a) => a !== id));
    } else {
      setAssigneeFilter([...current, id]);
    }
  };

  const isTasksView = () => currentView() === 'tasks';

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
    <Show when={categories().length > 0 || isTasksView()}>
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
              when={categories().length === 1 && !isTasksView()}
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
                      onToggle={toggleAssignee}
                      placeholder="Search assignees..."
                      multiple
                    />
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
