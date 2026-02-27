import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import { Select as KSelect } from '@kobalte/core/select';
import { cn } from '@ui/utils/classname';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  CHAT_CONTEXTUAL_FILTERS,
  GENERAL_CONTEXTUAL_FILTERS,
  TASK_PRIORITY_FILTERS,
} from '@app/component/next-soup/filters/filters';
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

/** Converts filter configs to Option format for FilterSelect */
const toFilterOptions = (
  filters: readonly { id: string; label: string }[]
): Option[] => filters.map((f) => ({ value: f.id, label: f.label }));

/** Hook to create filter state with active filters tracked */
const useFilterState = () => {
  const [activeFilters, setActiveFilters] = createSignal<
    Record<string, Option[]>
  >({});

  const getActive = (key: string): Option[] => activeFilters()[key] ?? [];

  const setActive = (key: string, options: Option[]) => {
    setActiveFilters((prev) => ({ ...prev, [key]: options }));
  };

  return { getActive, setActive };
};

const InboxFilters = () => {
  const { soup } = useSoupView();
  const filterState = useFilterState();

  const generalOptions = toFilterOptions(GENERAL_CONTEXTUAL_FILTERS);

  const handleGeneralChange = (options: Option[]) => {
    filterState.setActive('general', options);

    // Clear previous general filters
    for (const filter of GENERAL_CONTEXTUAL_FILTERS) {
      if (soup.filters.isActive(filter.id)) {
        soup.filters.deactivate(filter.id);
      }
    }

    // Activate selected filters
    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Activity"
        options={generalOptions}
        active={filterState.getActive('general')}
        onChange={handleGeneralChange}
      />
    </div>
  );
};

const AgentsFilters = () => {
  const { soup } = useSoupView();
  const filterState = useFilterState();

  const chatOptions = toFilterOptions(CHAT_CONTEXTUAL_FILTERS);

  const handleChatChange = (options: Option[]) => {
    filterState.setActive('chat', options);

    for (const filter of CHAT_CONTEXTUAL_FILTERS) {
      if (soup.filters.isActive(filter.id)) {
        soup.filters.deactivate(filter.id);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Activity"
        options={chatOptions}
        active={filterState.getActive('chat')}
        onChange={handleChatChange}
      />
    </div>
  );
};

const MailFilters = () => {
  const { soup } = useSoupView();
  const filterState = useFilterState();

  // Split email filters into read/unread and done/not-done groups
  const readStatusOptions: Option[] = [
    { value: 'email-unread', label: 'Unread' },
    { value: 'email-read', label: 'Read' },
  ];

  const doneStatusOptions: Option[] = [
    { value: 'email-not-done', label: 'Not Done' },
    { value: 'email-done', label: 'Done' },
  ];

  const handleReadStatusChange = (options: Option[]) => {
    filterState.setActive('readStatus', options);

    // Clear previous read status filters
    for (const opt of readStatusOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  const handleDoneStatusChange = (options: Option[]) => {
    filterState.setActive('doneStatus', options);

    for (const opt of doneStatusOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Read"
        options={readStatusOptions}
        active={filterState.getActive('readStatus')}
        onChange={handleReadStatusChange}
      />
      <FilterSelect
        label="Status"
        options={doneStatusOptions}
        active={filterState.getActive('doneStatus')}
        onChange={handleDoneStatusChange}
      />
    </div>
  );
};

const DocumentsFilters = () => {
  const { soup } = useSoupView();
  const filterState = useFilterState();

  // Recency filters
  const recencyOptions: Option[] = [
    { value: 'doc-recent', label: 'Recently Edited' },
    { value: 'doc-edited-this-week', label: 'Edited This Week' },
  ];

  // Type filters
  const typeOptions: Option[] = [
    { value: 'doc-markdown', label: 'Markdown' },
    { value: 'doc-canvas', label: 'Canvas' },
  ];

  // Location filter
  const locationOptions: Option[] = [
    { value: 'doc-in-folder', label: 'In Folder' },
  ];

  const handleRecencyChange = (options: Option[]) => {
    filterState.setActive('recency', options);

    for (const opt of recencyOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  const handleTypeChange = (options: Option[]) => {
    filterState.setActive('type', options);

    for (const opt of typeOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  const handleLocationChange = (options: Option[]) => {
    filterState.setActive('location', options);

    for (const opt of locationOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Recency"
        options={recencyOptions}
        active={filterState.getActive('recency')}
        onChange={handleRecencyChange}
      />
      <FilterSelect
        label="Type"
        options={typeOptions}
        active={filterState.getActive('type')}
        onChange={handleTypeChange}
      />
      <FilterSelect
        label="Location"
        options={locationOptions}
        active={filterState.getActive('location')}
        onChange={handleLocationChange}
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
  const filterState = useFilterState();
  const contacts = useContacts();
  const userId = useUserId();

  // Status options from TASK_STATUS_OPTIONS with icons
  const statusOptions: Option[] = TASK_STATUS_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
    icon: () => <PropertyValueIcon optionId={o.value} class="size-3.5" />,
  }));

  // Assignee options from contacts with user icons
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

  // Priority options with icons - map filter IDs to actual property option IDs for icons
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

  // Derive active status from context signal
  const activeStatus = createMemo((): Option[] => {
    const current = statusFilter();
    if (!current) return [];
    const opt = statusOptions.find((o) => o.value === current);
    return opt ? [opt] : [];
  });

  // Derive active assignee from context signal
  const activeAssignee = createMemo((): Option[] => {
    const current = assigneeFilter();
    if (!current) return [];
    const opt = assigneeOptions().find((o) => o.value === current);
    return opt ? [opt] : [];
  });

  const handleStatusChange = (options: Option[]) => {
    // Single-select behavior: use the last selected option or clear if empty
    const newValue =
      options.length > 0 ? options[options.length - 1].value : undefined;
    setStatusFilter(newValue);
  };

  const handleAssigneeChange = (options: Option[]) => {
    const newValue =
      options.length > 0 ? options[options.length - 1].value : undefined;
    setAssigneeFilter(newValue);
  };

  const handlePriorityChange = (options: Option[]) => {
    filterState.setActive('priority', options);

    for (const filter of TASK_PRIORITY_FILTERS) {
      if (soup.filters.isActive(filter.id)) {
        soup.filters.deactivate(filter.id);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Status"
        options={statusOptions}
        active={activeStatus()}
        onChange={handleStatusChange}
      />
      <FilterSelect
        label="Assignee"
        options={assigneeOptions()}
        active={activeAssignee()}
        onChange={handleAssigneeChange}
      />
      <FilterSelect
        label="Priority"
        options={priorityOptions}
        active={filterState.getActive('priority')}
        onChange={handlePriorityChange}
      />
    </div>
  );
};

const ChannelsFilters = () => {
  const { soup } = useSoupView();
  const filterState = useFilterState();

  // Activity filter
  const activityOptions: Option[] = [
    { value: 'channel-recent-activity', label: 'Recent Activity' },
  ];

  // Visibility filters
  const visibilityOptions: Option[] = [
    { value: 'channel-public', label: 'Public' },
    { value: 'channel-private', label: 'Private' },
  ];

  const handleActivityChange = (options: Option[]) => {
    filterState.setActive('activity', options);

    for (const opt of activityOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  const handleVisibilityChange = (options: Option[]) => {
    filterState.setActive('visibility', options);

    for (const opt of visibilityOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Activity"
        options={activityOptions}
        active={filterState.getActive('activity')}
        onChange={handleActivityChange}
      />
      <FilterSelect
        label="Visibility"
        options={visibilityOptions}
        active={filterState.getActive('visibility')}
        onChange={handleVisibilityChange}
      />
    </div>
  );
};

const FilesFilters = () => {
  const { soup } = useSoupView();
  const filterState = useFilterState();

  // File type filters based on FILE_ASSOCIATION_TYPES
  const fileTypeOptions: Option[] = [
    { value: 'file-code', label: 'Code' },
    { value: 'file-image', label: 'Images' },
    { value: 'file-pdf', label: 'PDFs' },
    { value: 'file-other', label: 'Other' },
  ];

  // General recency filters
  const recencyOptions: Option[] = [
    { value: 'recently-updated', label: 'Recently Updated' },
    { value: 'recently-created', label: 'Recently Created' },
  ];

  const handleFileTypeChange = (options: Option[]) => {
    filterState.setActive('fileType', options);

    for (const opt of fileTypeOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  const handleRecencyChange = (options: Option[]) => {
    filterState.setActive('recency', options);

    for (const opt of recencyOptions) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    for (const option of options) {
      soup.filters.activate(option.value);
    }
  };

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Type"
        options={fileTypeOptions}
        active={filterState.getActive('fileType')}
        onChange={handleFileTypeChange}
      />
      <FilterSelect
        label="Recency"
        options={recencyOptions}
        active={filterState.getActive('recency')}
        onChange={handleRecencyChange}
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
}

const FilterSelect = (props: FilterSelectProps) => {
  const activeFilters = createMemo(() => {
    return props.active;
  });

  const activeCount = createMemo(() => activeFilters().length);
  const hasActiveFilters = createMemo(() => activeCount() > 0);

  return (
    <KSelect<Option, never>
      options={props.options}
      value={activeFilters()}
      onChange={props.onChange}
      optionTextValue="label"
      optionValue="value"
      gutter={4}
      multiple
      placement="bottom-start"
      itemComponent={(itemProps) => (
        <KSelect.Item
          item={itemProps.item}
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
      )}
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
        <Show when={hasActiveFilters()}>
          <span class="absolute -top-2 -right-2 flex items-center justify-center size-4 rounded-full text-xs font-semibold bg-accent text-page">
            {activeCount()}
          </span>
        </Show>
        <ChevronDownIcon class="size-3" />
      </KSelect.Trigger>
      <KSelect.Portal>
        <KSelect.Content class="z-action-menu bg-panel border border-edge-muted rounded shadow-xl min-w-[var(--kb-popper-anchor-width)]">
          <KSelect.Listbox />
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
};
