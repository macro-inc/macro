import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import XIcon from '@icon/regular/x.svg';
import { Combobox } from '@kobalte/core/combobox';
import { Select as KSelect } from '@kobalte/core/select';
import { cn } from '@ui/utils/classname';
import {
  batch,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { AGENT_OWNERSHIP_FILTERS } from '@app/component/next-soup/filters/filters';
import { useProjectsQuery } from '@queries/storage/projects';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@core/component/Properties/constants';
import { UserIcon } from '@core/component/UserIcon';
import { TASK_STATUS_OPTIONS } from '@entity';
import { useContacts } from '@queries/contacts/contacts';
import { useUserId } from '@core/context/user';
import type { CollectionNode } from '@kobalte/core';

export const SoupViewContextFilters = () => {
  const panel = useSplitPanelOrThrow();

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  return (
    <div class="h-full flex items-center gap-1.5">
      <Switch>
        <Match when={isComponentListView('inbox')}>
          <InboxFilters />
        </Match>
        <Match when={isComponentListView('agents')}>
          <AgentsFilters />
        </Match>
        <Match when={isComponentListView('mail')}>
          <MailFilters />
        </Match>
        <Match when={isComponentListView('documents')}>
          <DocumentsFilters />
        </Match>
        <Match when={isComponentListView('tasks')}>
          <TasksFilters />
        </Match>
        <Match when={isComponentListView('channels')}>
          <ChannelsFilters />
        </Match>
        <Match when={isComponentListView('files')}>
          <FilesFilters />
        </Match>
      </Switch>
    </div>
  );
};

type UseFilterOptionsConfig = {
  multiple?: boolean;
  target?: 'and' | 'or';
};

const useFilterOptions = (
  options: Option[],
  config: UseFilterOptionsConfig = {}
) => {
  const { multiple = true, target = 'or' } = config;
  const { soup } = useSoupView();

  const optionIds = options.map((opt) => opt.value);

  const active = createMemo(() =>
    options.filter((opt) => soup.filters.isActive(opt.value))
  );

  const onChange = (selected: Option[]) => {
    const selectedIds = multiple
      ? selected.map((opt) => opt.value)
      : selected.length > 0
        ? [selected[selected.length - 1].value]
        : [];

    soup.filters.set((cur) => {
      if (target === 'and') {
        return {
          and: [
            ...cur.andIds.filter((id) => !optionIds.includes(id)),
            ...selectedIds,
          ],
          or: cur.orIds,
        };
      }
      return {
        and: cur.andIds,
        or: [
          ...cur.orIds.filter((id) => !optionIds.includes(id)),
          ...selectedIds,
        ],
      };
    });
  };

  return { active, onChange };
};

const InboxFilters = () => {
  return (
    <div class="flex items-center gap-1.5">{/* No inbox filters yet */}</div>
  );
};

const AgentsFilters = () => {
  const { setQueryFilters, queryFilters } = useSoupView();
  const projects = useProjectsQuery();

  // Ownership filter options (client-side filtering)
  const ownershipOptions: Option[] = AGENT_OWNERSHIP_FILTERS.map((f) => ({
    value: f.id,
    label: f.label,
  }));
  const ownership = useFilterOptions(ownershipOptions, { multiple: false });

  // Project filter options (API-level filtering via chat_filters.project_ids)
  const projectOptions = createMemo((): Option[] => {
    const data = projects.data;
    if (!data) return [];
    return data.map((project) => ({
      value: project.id,
      label: project.name,
    }));
  });

  // Track active project filter from queryFilters
  const activeProjectFilter = createMemo((): Option[] => {
    const projectIds = queryFilters().chat_filters?.project_ids;
    if (!projectIds?.length) return [];
    const options = projectOptions();
    return options.filter((opt) => projectIds.includes(opt.value));
  });

  const handleProjectChange = (selected: Option[]) => {
    const projectIds = selected.map((opt) => opt.value);
    batch(() => {
      setQueryFilters((prev) => ({
        ...prev,
        chat_filters: {
          ...prev.chat_filters,
          project_ids: projectIds.length > 0 ? projectIds : undefined,
        },
      }));
    });
  };

  return (
    <>
      <FilterSelect
        label="Owner"
        options={ownershipOptions}
        active={ownership.active()}
        onChange={ownership.onChange}
      />
      <Show when={projectOptions().length > 0}>
        <FilterCombobox
          label="Project"
          options={projectOptions()}
          active={activeProjectFilter()}
          onChange={handleProjectChange}
          placeholder="Search projects..."
          displayLimit={2}
          overflowLabel="projects"
          showIcons={false}
        />
      </Show>
    </>
  );
};

const MailFilters = () => {
  const readStatusOptions: Option[] = [
    { value: 'email-unread', label: 'Unread' },
    { value: 'email-read', label: 'Read' },
  ];

  const doneStatusOptions: Option[] = [
    { value: 'email-not-done', label: 'Not Done' },
    { value: 'email-done', label: 'Done' },
  ];

  const readStatus = useFilterOptions(readStatusOptions);
  const doneStatus = useFilterOptions(doneStatusOptions);

  return (
    <>
      <FilterSelect
        label="Read"
        options={readStatusOptions}
        active={readStatus.active()}
        onChange={readStatus.onChange}
      />
      <FilterSelect
        label="Status"
        options={doneStatusOptions}
        active={doneStatus.active()}
        onChange={doneStatus.onChange}
      />
    </>
  );
};

const DocumentsFilters = () => {
  const typeOptions: Option[] = [
    { value: 'doc-markdown', label: 'Markdown' },
    { value: 'doc-canvas', label: 'Canvas' },
  ];

  const locationOptions: Option[] = [
    { value: 'doc-in-folder', label: 'In Folder' },
  ];

  const type = useFilterOptions(typeOptions);
  const location = useFilterOptions(locationOptions);

  return (
    <>
      <FilterSelect
        label="Type"
        options={typeOptions}
        active={type.active()}
        onChange={type.onChange}
      />
      <FilterSelect
        label="Location"
        options={locationOptions}
        active={location.active()}
        onChange={location.onChange}
      />
    </>
  );
};

const TasksFilters = () => {
  const {
    soup,
    statusFilter,
    setStatusFilter,
    assigneeFilter,
    setAssigneeFilter,
  } = useSoupView();
  const contacts = useContacts();
  const userId = useUserId();

  const statusOptions: Option[] = TASK_STATUS_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
    icon: () => <PropertyValueIcon optionId={o.value} class="size-3.5" />,
  }));

  const assigneeOptions = createMemo((): Option[] => {
    const currentUserId = userId();
    return contacts().map((contact) => ({
      value: contact.id,
      label:
        contact.id === currentUserId
          ? contact.name
            ? `${contact.name} (me)`
            : 'Me'
          : contact.name || contact.id,
      icon: () => (
        <UserIcon id={contact.id} size="xs" suppressClick showTooltip={false} />
      ),
    }));
  });

  const priorityOptions: Option[] = [
    {
      value: 'task-critical',
      label: 'Critical',
      icon: () => (
        <PropertyValueIcon
          optionId={PROPERTY_OPTION_IDS.PRIORITY.URGENT}
          class="size-3.5"
        />
      ),
    },
    {
      value: 'task-high-priority',
      label: 'High Priority',
      icon: () => (
        <PropertyValueIcon
          optionId={PROPERTY_OPTION_IDS.PRIORITY.HIGH}
          class="size-3.5"
        />
      ),
    },
    {
      value: 'task-medium-priority',
      label: 'Medium Priority',
      icon: () => (
        <PropertyValueIcon
          optionId={PROPERTY_OPTION_IDS.PRIORITY.MEDIUM}
          class="size-3.5"
        />
      ),
    },
    {
      value: 'task-low-priority',
      label: 'Low Priority',
      icon: () => (
        <PropertyValueIcon
          optionId={PROPERTY_OPTION_IDS.PRIORITY.LOW}
          class="size-3.5"
        />
      ),
    },
    {
      value: 'task-no-priority',
      label: 'No Priority',
      // No icon for "no priority"
    },
  ];

  const priority = useFilterOptions(priorityOptions);

  const activeStatus = createMemo((): Option[] => {
    const current = statusFilter();
    return statusOptions.filter((o) => current.includes(o.value));
  });

  const activeAssignee = createMemo((): Option[] => {
    const current = assigneeFilter();
    const options = assigneeOptions();
    return options.filter((o) => current.includes(o.value));
  });

  const handleStatusChange = (options: Option[]) => {
    setStatusFilter(options.map((o) => o.value));
  };

  const handleAssigneeChange = (options: Option[]) => {
    setAssigneeFilter(options.map((o) => o.value));
  };

  return (
    <>
      <FilterSelect
        label="Status"
        options={statusOptions}
        active={activeStatus()}
        onChange={handleStatusChange}
      />
      <Show when={!soup.filters.isActive('assigned-to')}>
        <FilterCombobox
          label="Assignee"
          options={assigneeOptions()}
          active={activeAssignee()}
          onChange={handleAssigneeChange}
          placeholder="Search assignees..."
          displayLimit={3}
          overflowLabel="assignees"
        />
      </Show>
      <FilterSelect
        label="Priority"
        options={priorityOptions}
        active={priority.active()}
        onChange={priority.onChange}
      />
    </>
  );
};

const ChannelsFilters = () => {
  const visibilityOptions: Option[] = [
    { value: 'channel-public', label: 'Public' },
    { value: 'channel-private', label: 'Private' },
  ];

  const visibility = useFilterOptions(visibilityOptions);

  return (
    <FilterSelect
      label="Visibility"
      options={visibilityOptions}
      active={visibility.active()}
      onChange={visibility.onChange}
    />
  );
};

const FilesFilters = () => {
  const fileTypeOptions: Option[] = [
    { value: 'file-code', label: 'Code' },
    { value: 'file-image', label: 'Images' },
    { value: 'file-pdf', label: 'PDFs' },
    { value: 'file-other', label: 'Other' },
  ];

  const fileType = useFilterOptions(fileTypeOptions);

  return (
    <FilterChipGroup
      options={fileTypeOptions}
      active={fileType.active()}
      onChange={fileType.onChange}
    />
  );
};

type Option = {
  value: string;
  label: string;
  icon?: () => JSX.Element;
};

interface FilterSelectProps {
  label: string;
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
  multiple?: boolean;
}

const FilterSelect = (props: FilterSelectProps) => {
  const multiple = () => props.multiple ?? true;

  const activeFilters = createMemo(() => props.active);
  const activeCount = createMemo(() => activeFilters().length);
  const hasActiveFilters = createMemo(() => activeCount() > 0);

  const renderItem = (itemProps: { item: CollectionNode<Option> }) => (
    <KSelect.Item
      item={itemProps.item}
      class="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-xs transition-colors hover:bg-ink/5 group"
    >
      <span class="size-4 flex items-center justify-center shrink-0 rounded border border-edge-muted transition-colors group-data-[selected]:bg-accent group-data-[selected]:border-accent">
        <KSelect.ItemIndicator>
          <CheckIcon class="size-2.5 text-page" />
        </KSelect.ItemIndicator>
      </span>

      <Show when={itemProps.item.rawValue.icon}>
        {(icon) => (
          <span class="size-4 flex items-center justify-center shrink-0">
            {icon()()}
          </span>
        )}
      </Show>

      <KSelect.ItemLabel class="flex-1 truncate text-ink-muted group-data-[selected]:text-ink group-data-[selected]:font-medium">
        {itemProps.item.rawValue.label}
      </KSelect.ItemLabel>
    </KSelect.Item>
  );

  // For single select: convert to/from array format
  const value = () =>
    multiple() ? activeFilters() : (activeFilters()[0] ?? null);
  const handleChange = (selected: Option | Option[] | null) => {
    if (multiple()) {
      props.onChange(selected as Option[]);
    } else {
      props.onChange(selected ? [selected as Option] : []);
    }
  };

  return (
    <KSelect<Option>
      options={props.options}
      value={value() as Option & Option[]}
      onChange={handleChange as (value: Option & Option[]) => void}
      optionTextValue="label"
      optionValue="value"
      gutter={4}
      multiple={multiple()}
      placement="bottom-start"
      itemComponent={renderItem}
    >
      <KSelect.Trigger
        as="button"
        type="button"
        class={cn(
          'relative flex items-center gap-1 px-2 py-1.5 text-xs rounded-md bg-ink/8 text-ink-muted hover:bg-ink/12 hover:text-ink border border-transparent transition-all',
          hasActiveFilters() &&
            'bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25'
        )}
      >
        <span class="font-medium">{props.label}</span>
        <Show when={multiple() && hasActiveFilters()}>
          <span class="absolute -top-2 -right-2 flex items-center justify-center size-4 rounded-full text-xs font-semibold bg-accent text-page">
            {activeCount()}
          </span>
        </Show>
        <ChevronDownIcon class="size-3" />
      </KSelect.Trigger>
      <KSelect.Portal>
        <KSelect.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded-lg shadow-xl min-w-[var(--kb-popper-anchor-width)] p-1">
          <KSelect.Listbox />
          <div class="w-full py-1 px-2 flex items-center border-t border-t-edge-muted">
            <button
              type="button"
              class="ml-auto text-xs hover:bg-accent hover:text-page font-medium py-1 px-2 rounded-md"
              onClick={() => props.onChange([])}
            >
              Clear
            </button>
          </div>
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
};

interface FilterComboboxProps {
  label: string;
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
  placeholder?: string;
  /** Maximum number of items to display before showing overflow indicator (default: 2) */
  displayLimit?: number;
  /** Label for overflow count, e.g. "selected" results in "3 selected" (default: "selected") */
  overflowLabel?: string;
  /** Whether to show stacked icons in the value area (default: true) */
  showIcons?: boolean;
}

export const FilterCombobox = (props: FilterComboboxProps) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [listboxRef, setListboxRef] = createSignal<HTMLElement | undefined>();

  const displayLimit = () => props.displayLimit ?? 2;
  const overflowLabel = () => props.overflowLabel ?? 'selected';
  const showIcons = () => props.showIcons ?? true;

  const activeFilters = createMemo(() => props.active);
  const activeCount = createMemo(() => activeFilters().length);
  const hasActiveFilters = createMemo(() => activeCount() > 0);

  const visibleOptions = createMemo(() =>
    activeFilters().slice(0, displayLimit())
  );
  const overflowCount = createMemo(() =>
    Math.max(0, activeCount() - displayLimit())
  );
  const hasOverflow = createMemo(() => overflowCount() > 0);

  const filteredOptions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return props.options;
    return props.options.filter((opt) =>
      opt.label.toLowerCase().includes(query)
    );
  });

  const dispatchKeyToListbox = (key: string) => {
    listboxRef()?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key })
    );
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'j': {
        if (!e.ctrlKey) return;
        e.preventDefault();
        dispatchKeyToListbox('ArrowDown');
        break;
      }
      case 'k': {
        if (!e.ctrlKey) return;
        e.preventDefault();
        dispatchKeyToListbox('ArrowUp');
        break;
      }
    }
  };

  const onInputChange = (value: string) => {
    setSearchQuery(value);
    queueMicrotask(() => {
      dispatchKeyToListbox('ArrowDown');
    });
  };

  const onOpenChange = (open: boolean) => {
    if (!open) {
      setSearchQuery('');
    }
  };

  const removeOption = (e: MouseEvent, option: Option) => {
    e.stopPropagation();
    props.onChange(props.active.filter((o) => o.value !== option.value));
  };

  return (
    <Combobox<Option>
      class="max-h-full"
      multiple
      options={filteredOptions()}
      value={activeFilters()}
      sameWidth
      onChange={props.onChange}
      onOpenChange={onOpenChange}
      onInputChange={onInputChange}
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      placeholder={props.placeholder ?? 'Search...'}
      allowsEmptyCollection
      placement="bottom-start"
      gutter={4}
      triggerMode="focus"
      itemComponent={(itemProps) => (
        <Combobox.Item
          item={itemProps.item}
          class="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-xs transition-colors hover:bg-ink/5 data-[highlighted]:bg-ink/5 group"
        >
          <span class="size-4 flex items-center justify-center shrink-0 rounded border border-edge-muted transition-colors group-data-[selected]:bg-accent group-data-[selected]:border-accent">
            <Combobox.ItemIndicator>
              <CheckIcon class="size-2.5 text-page" />
            </Combobox.ItemIndicator>
          </span>

          <Show when={itemProps.item.rawValue.icon}>
            {(icon) => (
              <span class="size-4 flex items-center justify-center shrink-0">
                {icon()()}
              </span>
            )}
          </Show>

          <Combobox.ItemLabel class="flex-1 truncate text-ink-muted group-data-[selected]:text-ink group-data-[selected]:font-medium">
            {itemProps.item.rawValue.label}
          </Combobox.ItemLabel>
        </Combobox.Item>
      )}
    >
      <Combobox.Control class="max-h-8 flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md bg-ink/8 text-ink-muted hover:bg-ink/12 transition-all overflow-hidden">
        <Show when={showIcons() && hasActiveFilters()}>
          {/* Icons stacked on top of each other with offset */}
          <div
            class="relative shrink-0"
            style={{
              width: `${16 + (Math.min(activeCount(), displayLimit() + (hasOverflow() ? 1 : 0)) - 1) * 6}px`,
              height: '16px',
            }}
          >
            <For each={visibleOptions()}>
              {(option, index) => (
                <Show when={option.icon}>
                  {(icon) => (
                    <span
                      class="absolute size-4 flex items-center justify-center rounded-full bg-surface-0 ring-1 ring-edge-muted"
                      style={{ left: `${index() * 6}px`, 'z-index': index() }}
                    >
                      {icon()()}
                    </span>
                  )}
                </Show>
              )}
            </For>
            <Show when={hasOverflow()}>
              <span
                class="absolute size-4 flex items-center justify-center rounded-full bg-surface-1 text-ink-muted text-[9px] font-semibold ring-1 ring-edge-muted"
                style={{
                  left: `${displayLimit() * 6}px`,
                  'z-index': displayLimit(),
                }}
              >
                +{overflowCount()}
              </span>
            </Show>
          </div>
        </Show>

        <div class="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          <Show
            when={!hasOverflow()}
            fallback={
              <span class="flex items-center px-2 py-0.5 rounded-full bg-ink/10 text-ink text-xs">
                <span class="font-medium truncate">
                  {activeCount()} {overflowLabel()} selected
                </span>
              </span>
            }
          >
            <For each={visibleOptions()}>
              {(option) => (
                <span class="flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded-full bg-ink/10 text-ink text-xs">
                  <span class="font-medium truncate">{option.label}</span>
                  <button
                    type="button"
                    class="size-3.5 flex items-center justify-center rounded-full hover:bg-ink/20 transition-colors"
                    onClick={(e) => removeOption(e, option)}
                    aria-label={`Remove ${option.label}`}
                  >
                    <XIcon class="size-2" />
                  </button>
                </span>
              )}
            </For>
          </Show>
          <Combobox.Input
            class="flex-1 text-xs bg-transparent outline-none caret-accent placeholder:text-ink-faint"
            placeholder={
              hasActiveFilters()
                ? 'Add more...'
                : (props.placeholder ??
                  `Filter by ${props.label.toLowerCase()}...`)
            }
          />
        </div>
        <Show when={hasActiveFilters()}>
          <button
            type="button"
            class="size-4 flex items-center justify-center shrink-0 rounded-full hover:bg-ink/20 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              props.onChange([]);
            }}
            aria-label="Clear all"
          >
            <XIcon class="size-2.5" />
          </button>
        </Show>
        <ChevronDownIcon class="size-4" />
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content
          class="z-action-menu bg-surface-0 border border-edge-muted rounded-lg p-1 shadow-xl min-w-[200px] max-w-[var(--kb-popper-anchor-width)]"
          on:keydown={handleKeyDown}
        >
          <Show
            when={filteredOptions().length > 0}
            fallback={
              <div class="py-3 px-2 text-center text-xs text-ink-muted whitespace-break-spaces break-words">
                No options match "{searchQuery()}"
              </div>
            }
          >
            <Combobox.Listbox
              ref={setListboxRef}
              class="max-h-[200px] overflow-y-auto"
            />
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
};

interface FilterChipGroupProps {
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
  multiple?: boolean;
}

export const FilterChipGroup = (props: FilterChipGroupProps) => {
  const multiple = () => props.multiple ?? true;

  const activeSet = createMemo(() => new Set(props.active.map((o) => o.value)));

  const isActive = (value: string) => activeSet().has(value);

  const handleClick = (option: Option) => {
    const currentlyActive = isActive(option.value);

    if (!multiple()) {
      props.onChange(currentlyActive ? [] : [option]);
      return;
    }

    if (currentlyActive) {
      props.onChange(props.active.filter((o) => o.value !== option.value));
    } else {
      props.onChange([...props.active, option]);
    }
  };

  return (
    <div class="flex items-center gap-1 flex-wrap">
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class={cn(
              'flex items-center gap-1.5 px-2 py-1 text-xs rounded-full border transition-all',
              isActive(option.value)
                ? 'bg-accent/15 text-accent border-accent/30 hover:bg-accent/25'
                : 'bg-ink/8 text-ink-muted border-transparent hover:bg-ink/12 hover:text-ink'
            )}
            onClick={() => handleClick(option)}
          >
            <Show when={option.icon}>
              {(icon) => (
                <span class="size-3.5 flex items-center justify-center shrink-0">
                  {icon()()}
                </span>
              )}
            </Show>
            <span class="font-medium">{option.label}</span>
          </button>
        )}
      </For>
    </div>
  );
};
