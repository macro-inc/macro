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

export const SoupFiltersBar = () => {
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
  );
};

type UseFilterOptionsConfig = {
  /** Whether multiple options can be selected. Defaults to true. */
  multiple?: boolean;
  /** Whether to apply changes to 'and' or 'or' filters. Defaults to 'or'. */
  target?: 'and' | 'or';
};

/**
 * Hook that derives active options from soup.filters and provides a change handler.
 * Accesses soup context internally.
 */
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
    <div class="flex items-center gap-1.5">
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
        />
      </Show>
    </div>
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
    <div class="flex items-center gap-1.5">
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
    </div>
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
    <div class="flex items-center gap-1.5">
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
    </div>
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
    <div class="flex items-center gap-1.5">
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
        />
      </Show>
      <FilterSelect
        label="Priority"
        options={priorityOptions}
        active={priority.active()}
        onChange={priority.onChange}
      />
    </div>
  );
};

const ChannelsFilters = () => {
  const visibilityOptions: Option[] = [
    { value: 'channel-public', label: 'Public' },
    { value: 'channel-private', label: 'Private' },
  ];

  const visibility = useFilterOptions(visibilityOptions);

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Visibility"
        options={visibilityOptions}
        active={visibility.active()}
        onChange={visibility.onChange}
      />
    </div>
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
    <div class="flex items-center gap-1.5">
      <FilterChipGroup
        options={fileTypeOptions}
        active={fileType.active()}
        onChange={fileType.onChange}
      />
    </div>
  );
};

type Option = {
  value: string;
  label: string;
  /** Optional icon to render for this option */
  icon?: () => JSX.Element;
};

interface FilterSelectProps {
  label: string;
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
  /** Whether multiple options can be selected. Defaults to true. */
  multiple?: boolean;
}

const FilterSelect = (props: FilterSelectProps) => {
  const isMultiple = () => props.multiple ?? true;

  const activeFilters = createMemo(() => props.active);
  const activeCount = createMemo(() => activeFilters().length);
  const hasActiveFilters = createMemo(() => activeCount() > 0);

  const renderItem = (itemProps: { item: { rawValue: Option } }) => (
    <KSelect.Item
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      item={itemProps.item as any}
      class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-ink/5 group"
    >
      <span
        class={
          'size-4 flex items-center justify-center shrink-0 rounded border border-edge-muted transition-colors group-data-[selected]:bg-accent group-data-[selected]:border-accent'
        }
      >
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

  const TriggerContent = () => (
    <>
      <span class="font-medium">{props.label}</span>
      <Show when={isMultiple() && hasActiveFilters()}>
        <span class="absolute -top-2 -right-2 flex items-center justify-center size-4 rounded-full text-xs font-semibold bg-accent text-page">
          {activeCount()}
        </span>
      </Show>
      <ChevronDownIcon class="size-3" />
    </>
  );

  const ContentFooter = () => (
    <div class="w-full py-1 px-2 flex items-center border-t border-t-edge-muted">
      <button
        type="button"
        class="ml-auto text-xs hover:bg-accent hover:text-page font-medium py-1 px-2 rounded-md"
        onClick={() => props.onChange([])}
      >
        Clear
      </button>
    </div>
  );

  return (
    <Show
      when={isMultiple()}
      fallback={
        <KSelect<Option>
          options={props.options}
          value={activeFilters()[0] ?? null}
          onChange={(selected) => props.onChange(selected ? [selected] : [])}
          optionTextValue="label"
          optionValue="value"
          gutter={4}
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
            <TriggerContent />
          </KSelect.Trigger>
          <KSelect.Portal>
            <KSelect.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded shadow-xl min-w-[var(--kb-popper-anchor-width)]">
              <KSelect.Listbox />
              <ContentFooter />
            </KSelect.Content>
          </KSelect.Portal>
        </KSelect>
      }
    >
      <KSelect<Option>
        options={props.options}
        value={activeFilters()}
        onChange={props.onChange}
        optionTextValue="label"
        optionValue="value"
        gutter={4}
        multiple
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
          <TriggerContent />
        </KSelect.Trigger>
        <KSelect.Portal>
          <KSelect.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded shadow-xl min-w-[var(--kb-popper-anchor-width)]">
            <KSelect.Listbox />
            <ContentFooter />
          </KSelect.Content>
        </KSelect.Portal>
      </KSelect>
    </Show>
  );
};

interface FilterComboboxProps {
  label: string;
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
  /** Placeholder text for the search input */
  placeholder?: string;
}

/**
 * A searchable multi-select filter component using Combobox.
 * Features:
 * - Search bar in the dropdown body
 * - Selected options displayed in the trigger
 * - Clear button to reset selection
 */
export const FilterCombobox = (props: FilterComboboxProps) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [listboxRef, setListboxRef] = createSignal<HTMLElement | undefined>();

  const activeFilters = createMemo(() => props.active);
  const activeCount = createMemo(() => activeFilters().length);
  const hasActiveFilters = createMemo(() => activeCount() > 0);

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
      multiple
      options={filteredOptions()}
      value={activeFilters()}
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
      defaultFilter={() => true}
      itemComponent={(itemProps) => (
        <Combobox.Item
          item={itemProps.item}
          class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-ink/5 data-[highlighted]:bg-ink/5 group"
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
      <Combobox.Control class="flex items-start gap-1 px-1.5 py-1 text-xs rounded-md bg-ink/8 text-ink-muted hover:bg-ink/12 transition-all max-h-[76px]">
        <div class="flex flex-wrap items-center gap-1 flex-1 max-h-[60px] overflow-y-auto">
          <For each={activeFilters()}>
            {(option) => (
              <span class="flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded-full bg-ink/10 text-ink text-xs">
                <Show when={option.icon}>
                  {(icon) => (
                    <span class="size-3 flex items-center justify-center shrink-0">
                      {icon()()}
                    </span>
                  )}
                </Show>
                <span class="font-medium max-w-[80px] truncate">
                  {option.label}
                </span>
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
          <Combobox.Input
            class="flex-1 min-w-[60px] text-xs bg-transparent outline-none caret-accent placeholder:text-ink-faint"
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
            class="size-4 flex items-center justify-center shrink-0 rounded-full hover:bg-ink/20 transition-colors mt-0.5"
            onClick={(e) => {
              e.stopPropagation();
              props.onChange([]);
            }}
            aria-label="Clear all"
          >
            <XIcon class="size-2.5" />
          </button>
        </Show>
        <ChevronDownIcon class="size-3 shrink-0 mt-1" />
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content
          class="z-action-menu bg-surface-0 border border-edge-muted rounded shadow-xl min-w-[200px]"
          on:keydown={handleKeyDown}
        >
          <Show
            when={filteredOptions().length > 0}
            fallback={
              <div class="py-3 px-2 text-center text-xs text-ink-muted">
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
  /** Whether to allow multiple selections. Defaults to true. */
  multiple?: boolean;
}

/**
 * A group of chip buttons for selecting filter options.
 * Each chip toggles its selection state when clicked.
 */
export const FilterChipGroup = (props: FilterChipGroupProps) => {
  const multiple = () => props.multiple ?? true;

  const activeSet = createMemo(() => new Set(props.active.map((o) => o.value)));

  const isActive = (value: string) => activeSet().has(value);

  const handleClick = (option: Option) => {
    const currentlyActive = isActive(option.value);

    if (multiple()) {
      // Toggle the option
      if (currentlyActive) {
        props.onChange(props.active.filter((o) => o.value !== option.value));
      } else {
        props.onChange([...props.active, option]);
      }
    } else {
      // Single select: toggle off if already selected, otherwise select only this one
      if (currentlyActive) {
        props.onChange([]);
      } else {
        props.onChange([option]);
      }
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
