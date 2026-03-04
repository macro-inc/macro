import { VIEW_TAB_PRESETS } from '@app/component/app-sidebar/soup-filter-presets';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import FileCodeIcon from '@icon/regular/file-code.svg';
import FileImageIcon from '@icon/regular/file-image.svg';
import FilePdfIcon from '@icon/regular/file-pdf.svg';
import FileIcon from '@icon/regular/file.svg';
import { batch, createMemo, Match, Show, Switch } from 'solid-js';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useProjectsQuery } from '@queries/storage/projects';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@core/component/Properties/constants';
import { EntityIcon } from '@core/component/EntityIcon';
import { TASK_STATUS_OPTIONS } from '@entity';
import {
  getFileAssociations,
  QUERY_FILTERS_BASE,
} from '@app/component/next-soup/filters/filters';
import { ChannelTypeEnum } from '@service-comms/client';
import type { ChannelType } from '@service-comms/generated/models';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import {
  FilterChipGroup,
  FilterCombobox,
  FilterSelect,
  type Option,
} from './filter-primitives';
import { useFilterOptions } from './use-filter-options';
import { AssigneeFilter } from './filter-controls';

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

/**
 * Builds query filters for selected entity types, merging with current filters.
 * When no entity types are selected, returns currentFilters unchanged.
 * When entity types are selected, preserves existing filter properties (like
 * notification_filters, importance, etc.) while restricting to selected types.
 */
const getEntityTypeQueryFilters = (
  selectedIds: string[],
  currentFilters: SoupItemsQueryFilters
): SoupItemsQueryFilters => {
  // No selection = no entity type restriction, keep current filters
  if (selectedIds.length === 0) return currentFilters;

  // Start with base (everything excluded) then selectively enable types
  // while preserving existing filter properties from currentFilters
  const result: SoupItemsQueryFilters = { ...QUERY_FILTERS_BASE };

  const selected = new Set(selectedIds);

  // Agent - preserve existing chat_filters properties
  if (selected.has('agent')) {
    result.chat_filters = { ...currentFilters.chat_filters };
  }

  // Email - preserve existing email_filters properties
  if (selected.has('email')) {
    result.email_filters = { ...currentFilters.email_filters };
  }

  // Channels - preserve existing channel_filters properties, add channel_types restriction
  const includesPeople = selected.has('people');
  const includesTeams = selected.has('teams');
  if (includesPeople || includesTeams) {
    const channelTypes: ChannelType[] = [];
    if (includesPeople) {
      channelTypes.push(ChannelTypeEnum.DirectMessage);
    }
    if (includesTeams) {
      channelTypes.push(
        ChannelTypeEnum.Private,
        ChannelTypeEnum.Organization,
        ChannelTypeEnum.Public
      );
    }
    result.channel_filters = {
      ...currentFilters.channel_filters,
      channel_types: channelTypes,
    };
  }

  // Documents - preserve existing document_filters properties, add file_types restriction
  const includesDocuments = selected.has('document');
  const includesTasks = selected.has('task');
  const includesFiles = selected.has('file');
  if (includesDocuments || includesTasks || includesFiles) {
    const fileTypes: string[] = [];
    if (includesDocuments) {
      fileTypes.push('md', 'canvas');
    }
    if (includesTasks) {
      fileTypes.push('md');
    }
    if (includesFiles) {
      fileTypes.push(...getFileAssociations('soup'));
    }
    result.document_filters = {
      ...currentFilters.document_filters,
      file_types: [...new Set(fileTypes)],
    };
  }

  return result;
};

const InboxFilters = () => {
  const { activeTab } = useSoupView();

  // Get base query filters from the current tab preset (used when clearing entity type filter)
  const baseQueryFilters = createMemo(() => {
    const tabId = activeTab() ?? VIEW_TAB_PRESETS.inbox.default;
    const resolver = VIEW_TAB_PRESETS.inbox.tabs[tabId];
    // Inbox presets don't use context, so we can pass undefined values
    return (
      resolver?.({ userId: undefined, email: undefined })?.queryFilters ?? {}
    );
  });

  const entityTypeOptions: Option[] = [
    {
      value: 'document',
      label: 'Docs',
      icon: () => <EntityIcon targetType="md" size="xs" />,
    },
    {
      value: 'agent',
      label: 'Agents',
      icon: () => <EntityIcon targetType="chat" size="xs" />,
    },
    {
      value: 'people',
      label: 'People',
      icon: () => <EntityIcon targetType="direct_message" size="xs" />,
    },
    {
      value: 'teams',
      label: 'Teams',
      icon: () => <EntityIcon targetType="channel" size="xs" />,
    },
    {
      value: 'task',
      label: 'Tasks',
      icon: () => <EntityIcon targetType="task" size="xs" />,
    },
    {
      value: 'email',
      label: 'Mail',
      icon: () => <EntityIcon targetType="email" size="xs" />,
    },
    {
      value: 'file',
      label: 'Files',
      icon: () => <EntityIcon targetType="unknown" size="xs" />,
    },
  ];

  const entityType = useFilterOptions(entityTypeOptions, {
    getQueryFilters: (selectedIds) =>
      getEntityTypeQueryFilters(selectedIds, baseQueryFilters()),
  });

  return (
    <FilterSelect
      label="Type"
      options={entityTypeOptions}
      active={entityType.active()}
      onChange={entityType.onChange}
    />
  );
};

const AgentsFilters = () => {
  const { setQueryFilters, queryFilters } = useSoupView();
  const projects = useProjectsQuery();

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
  const { soup, statusFilter, setStatusFilter } = useSoupView();

  const statusOptions: Option[] = TASK_STATUS_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
    icon: () => <PropertyValueIcon optionId={o.value} class="size-3.5" />,
  }));

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

  const handleStatusChange = (options: Option[]) => {
    setStatusFilter(options.map((o) => o.value));
  };

  return (
    <>
      <FilterSelect
        label="Status"
        options={statusOptions}
        active={activeStatus()}
        onChange={handleStatusChange}
      />
      <FilterSelect
        label="Priority"
        options={priorityOptions}
        active={priority.active()}
        onChange={priority.onChange}
      />
      <Show when={!soup.filters.isActive('assigned-to')}>
        <AssigneeFilter />
      </Show>
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
    {
      value: 'file-code',
      label: 'Code',
      icon: () => <FileCodeIcon class="size-3.5" />,
    },
    {
      value: 'file-image',
      label: 'Images',
      icon: () => <FileImageIcon class="size-3.5" />,
    },
    {
      value: 'file-pdf',
      label: 'PDFs',
      icon: () => <FilePdfIcon class="size-3.5" />,
    },
    {
      value: 'file-other',
      label: 'Other',
      icon: () => <FileIcon class="size-3.5" />,
    },
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
