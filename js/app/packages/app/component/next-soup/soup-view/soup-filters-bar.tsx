import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import { Select as KSelect } from '@kobalte/core/select';
import { cn } from '@ui/utils/classname';
import { createMemo, type JSX, Match, Show, Switch } from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  CHAT_CONTEXTUAL_FILTERS,
  GENERAL_CONTEXTUAL_FILTERS,
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

/**
 * Hook that derives active options from soup.filters and provides a change handler.
 * Accesses soup context internally.
 */
const useFilterOptions = (options: Option[]) => {
  const { soup } = useSoupView();

  const active = createMemo(() =>
    options.filter((opt) => soup.filters.isActive(opt.value))
  );

  const onChange = (selected: Option[]) => {
    // Deactivate all options in this group first
    for (const opt of options) {
      if (soup.filters.isActive(opt.value)) {
        soup.filters.deactivate(opt.value);
      }
    }

    // Activate selected options
    for (const option of selected) {
      soup.filters.activate(option.value);
    }
  };

  return { active, onChange };
};

const InboxFilters = () => {
  const generalOptions = toFilterOptions(GENERAL_CONTEXTUAL_FILTERS);
  const general = useFilterOptions(generalOptions);

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Activity"
        options={generalOptions}
        active={general.active()}
        onChange={general.onChange}
      />
    </div>
  );
};

const AgentsFilters = () => {
  const chatOptions = toFilterOptions(CHAT_CONTEXTUAL_FILTERS);
  const chat = useFilterOptions(chatOptions);

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Activity"
        options={chatOptions}
        active={chat.active()}
        onChange={chat.onChange}
      />
    </div>
  );
};

const MailFilters = () => {
  // Split email filters into read/unread and done/not-done groups
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

  const recency = useFilterOptions(recencyOptions);
  const type = useFilterOptions(typeOptions);
  const location = useFilterOptions(locationOptions);

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Recency"
        options={recencyOptions}
        active={recency.active()}
        onChange={recency.onChange}
      />
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
  const { statusFilter, setStatusFilter, assigneeFilter, setAssigneeFilter } =
    useSoupView();
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

  // Priority uses soup.filters via the hook
  const priority = useFilterOptions(priorityOptions);

  // Derive active status from context signal (special handling for single-select)
  const activeStatus = createMemo((): Option[] => {
    const current = statusFilter();
    if (!current) return [];
    const opt = statusOptions.find((o) => o.value === current);
    return opt ? [opt] : [];
  });

  // Derive active assignee from context signal (special handling for single-select)
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
        active={priority.active()}
        onChange={priority.onChange}
      />
    </div>
  );
};

const ChannelsFilters = () => {
  // Activity filter
  const activityOptions: Option[] = [
    { value: 'channel-recent-activity', label: 'Recent Activity' },
  ];

  // Visibility filters
  const visibilityOptions: Option[] = [
    { value: 'channel-public', label: 'Public' },
    { value: 'channel-private', label: 'Private' },
  ];

  const activity = useFilterOptions(activityOptions);
  const visibility = useFilterOptions(visibilityOptions);

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Activity"
        options={activityOptions}
        active={activity.active()}
        onChange={activity.onChange}
      />
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

  const fileType = useFilterOptions(fileTypeOptions);
  const recency = useFilterOptions(recencyOptions);

  return (
    <div class="flex items-center gap-1.5">
      <FilterSelect
        label="Type"
        options={fileTypeOptions}
        active={fileType.active()}
        onChange={fileType.onChange}
      />
      <FilterSelect
        label="Recency"
        options={recencyOptions}
        active={recency.active()}
        onChange={recency.onChange}
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
