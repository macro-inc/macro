import CircleDashedIcon from '@icon/regular/circle-dashed.svg';
import FileCodeIcon from '@icon/regular/file-code.svg';
import FileImageIcon from '@icon/regular/file-image.svg';
import FilePdfIcon from '@icon/regular/file-pdf.svg';
import FileIcon from '@icon/regular/file.svg';
import FolderIcon from '@icon/regular/folder.svg';
import { createMemo, Show } from 'solid-js';
import { VIEW_TAB_PRESETS } from '@app/component/app-sidebar/soup-filter-presets';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { UserIcon } from '@core/component/UserIcon';
import { filterMap } from '@core/util/list';
import { useUserId } from '@core/context/user';
import { NO_ASSIGNEE } from '@app/component/next-soup/soup-view/task-sub-filter-matcher';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@core/component/Properties/constants';
import { EntityIcon } from '@core/component/EntityIcon';
import { useProjectsQuery } from '@queries/storage/projects';
import {
  getFileAssociations,
  QUERY_FILTERS_BASE,
} from '@app/component/next-soup/filters/query-filters';
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
import { useQuickAccess } from '@core/context/quickAccess';
import { TASK_STATUS_FILTERS } from '@app/component/next-soup/filters/configs';

export const AssigneeFilter = () => {
  const { assigneeFilter, setAssigneeFilter } = useSoupView();
  const { useList } = useQuickAccess();
  const contacts = useList('person');
  const userId = useUserId();

  const assigneeOptions = createMemo((): Option[] => {
    const currentUserId = userId();

    const noAssigneeOption: Option = {
      value: NO_ASSIGNEE,
      label: 'No assignee',
      icon: () => <CircleDashedIcon class="size-4 text-ink-muted" />,
    };

    let me: Option | undefined;

    const otherContactOptions = filterMap(
      contacts(),
      (contact): Option | undefined => {
        const opt: Option = {
          value: contact.id,
          label:
            contact.id === currentUserId
              ? `${contact.data.name || 'Me'} (me)`
              : contact.data.name || contact.id,
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
          me = opt;
          return undefined;
        }

        return opt;
      }
    );

    return [noAssigneeOption, ...(me ? [me] : []), ...otherContactOptions];
  });

  const activeAssignee = createMemo((): Option[] => {
    const current = assigneeFilter();
    const options = assigneeOptions();
    return options.filter((o) => current.includes(o.value));
  });

  const handleAssigneeChange = (options: Option[]) => {
    setAssigneeFilter(options.map((o) => o.value));
  };

  return (
    <FilterCombobox
      label="Assignee"
      options={assigneeOptions()}
      active={activeAssignee()}
      onChange={handleAssigneeChange}
      placeholder="Search assignees..."
      virtualized
    />
  );
};

const getEntityTypeQueryFilters = (
  selectedIds: string[],
  currentFilters: SoupItemsQueryFilters
): SoupItemsQueryFilters => {
  if (selectedIds.length === 0) return currentFilters;

  const result: SoupItemsQueryFilters = { ...QUERY_FILTERS_BASE };
  const selected = new Set(selectedIds);

  if (selected.has('agent')) {
    result.chat_filters = { ...currentFilters.chat_filters };
  }

  if (selected.has('email')) {
    result.email_filters = { ...currentFilters.email_filters };
  }

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

export const EntityTypeFilter = () => {
  const { activeTab } = useSoupView();

  const baseQueryFilters = createMemo(() => {
    const tabId = activeTab() ?? VIEW_TAB_PRESETS.inbox.default;
    const resolver = VIEW_TAB_PRESETS.inbox.tabs[tabId];
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

type FolderFilterTarget = 'chat' | 'document' | 'email';

interface FolderFilterProps {
  target: FolderFilterTarget;
  label?: string;
}

export const FolderFilter = (props: FolderFilterProps) => {
  const { setQueryFilters, queryFilters } = useSoupView();
  const projects = useProjectsQuery();

  const label = () => props.label ?? 'Folder';

  const projectOptions = createMemo((): Option[] => {
    const data = projects.data;
    if (!data) return [];
    return data.map((project) => ({
      value: project.id,
      label: project.name,
    }));
  });

  const activeProjectFilter = createMemo((): Option[] => {
    const filters = queryFilters();

    const projectIds =
      props.target === 'chat'
        ? filters.chat_filters?.project_ids
        : props.target === 'email'
          ? filters.email_filters?.project_ids
          : filters.document_filters?.project_ids;

    if (!projectIds?.length) return [];

    const options = projectOptions();

    return options.filter((opt) => projectIds.includes(opt.value));
  });

  const handleProjectChange = (selected: Option[]) => {
    const projectIds = selected.map((opt) => opt.value);

    const newProjectIds = projectIds.length > 0 ? projectIds : undefined;

    setQueryFilters((prev) => {
      if (props.target === 'chat') {
        return {
          ...prev,
          chat_filters: {
            ...prev.chat_filters,
            project_ids: newProjectIds,
          },
        };
      }

      if (props.target === 'email') {
        return {
          ...prev,
          email_filters: {
            ...prev.email_filters,
            project_ids: newProjectIds,
          },
        };
      }

      return {
        ...prev,
        document_filters: {
          ...prev.document_filters,
          project_ids: newProjectIds,
        },
      };
    });
  };

  return (
    <Show when={projectOptions().length > 0}>
      <FilterCombobox
        label={label()}
        options={projectOptions()}
        active={activeProjectFilter()}
        onChange={handleProjectChange}
        placeholder="Search folders..."
        virtualized
      />
    </Show>
  );
};

export const ProjectFilter = () => {
  return <FolderFilter target="chat" label="Folder" />;
};

export const StatusFilter = () => {
  const statusOptions: Option[] = [
    { value: 'unread', label: 'Unread' },
    { value: 'read', label: 'Read' },
    { value: 'not-done', label: 'Not done' },
    { value: 'done', label: 'Done' },
  ];

  const status = useFilterOptions(statusOptions, { target: 'and' });

  return (
    <FilterSelect
      label="Status"
      options={statusOptions}
      active={status.active()}
      onChange={status.onChange}
    />
  );
};

export const DocumentTypeFilter = () => {
  const typeOptions: Option[] = [
    { value: 'doc-markdown', label: 'Markdown' },
    { value: 'doc-canvas', label: 'Canvas' },
  ];

  const type = useFilterOptions(typeOptions);

  return (
    <FilterSelect
      label="Type"
      options={typeOptions}
      active={type.active()}
      onChange={type.onChange}
    />
  );
};

export const DocumentFolderFilter = () => {
  return <FolderFilter target="document" label="Folder" />;
};

const STATUS_FILTER_PROPERTY_ID = {
  'task-not-started': PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
  'task-in-progress': PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
  'task-in-review': PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
  'task-completed': PROPERTY_OPTION_IDS.STATUS.COMPLETED,
  'task-canceled': PROPERTY_OPTION_IDS.STATUS.CANCELED,
} satisfies Record<(typeof TASK_STATUS_FILTERS)[number]['id'], string>;

export const TaskStatusFilter = () => {
  const statusOptions = TASK_STATUS_FILTERS.map((o) => ({
    value: o.id,
    label: o.label ?? 'Unknown status',
    icon: () => (
      <PropertyValueIcon
        optionId={STATUS_FILTER_PROPERTY_ID[o.id]}
        class="size-3.5"
      />
    ),
  }));

  const status = useFilterOptions(statusOptions, { target: 'or' });

  return (
    <FilterSelect
      label="Status"
      options={statusOptions}
      active={status.active()}
      onChange={status.onChange}
    />
  );
};

export const TaskPriorityFilter = () => {
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
      label: 'High priority',
      icon: () => (
        <PropertyValueIcon
          optionId={PROPERTY_OPTION_IDS.PRIORITY.HIGH}
          class="size-3.5"
        />
      ),
    },
    {
      value: 'task-medium-priority',
      label: 'Medium priority',
      icon: () => (
        <PropertyValueIcon
          optionId={PROPERTY_OPTION_IDS.PRIORITY.MEDIUM}
          class="size-3.5"
        />
      ),
    },
    {
      value: 'task-low-priority',
      label: 'Low priority',
      icon: () => (
        <PropertyValueIcon
          optionId={PROPERTY_OPTION_IDS.PRIORITY.LOW}
          class="size-3.5"
        />
      ),
    },
    {
      value: 'task-no-priority',
      label: 'No priority',
    },
  ];

  const priority = useFilterOptions(priorityOptions);

  return (
    <FilterSelect
      label="Priority"
      options={priorityOptions}
      active={priority.active()}
      onChange={priority.onChange}
    />
  );
};

export const ChannelVisibilityFilter = () => {
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

export const FileTypeFilter = () => {
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

export const FoldersFilter = () => {
  const foldersOptions: Option[] = [
    {
      value: 'folders',
      label: 'Folders',
      icon: () => <FolderIcon class="size-3.5" />,
    },
  ];

  const folders = useFilterOptions(foldersOptions);

  return (
    <FilterChipGroup
      options={foldersOptions}
      active={folders.active()}
      onChange={folders.onChange}
    />
  );
};

export const FromSenderFilter = () => {
  const { setQueryFilters, queryFilters } = useSoupView();
  const { useList } = useQuickAccess();
  const contacts = useList('person');

  const senderOptions = createMemo((): Option[] => {
    return filterMap(contacts(), (contact): Option | undefined => {
      const value = contact.data.email ?? contact.id;
      if (!value) return undefined;

      return {
        value,
        label: contact.data.name || contact.data.email || contact.id,
        icon: () => (
          <UserIcon
            id={contact.id}
            size="xs"
            suppressClick
            showTooltip={false}
          />
        ),
      };
    });
  });

  const activeSenderFilter = createMemo((): Option[] => {
    const senders = queryFilters().email_filters?.senders;
    if (!senders?.length) return [];

    const options = senderOptions();
    return options.filter((opt) => senders.includes(opt.value));
  });

  const handleSenderChange = (selected: Option[]) => {
    const senders = selected.map((opt) => opt.value);
    const newSenders = senders.length > 0 ? senders : undefined;

    setQueryFilters((prev) => ({
      ...prev,
      email_filters: {
        ...prev.email_filters,
        senders: newSenders,
      },
    }));
  };

  return (
    <Show when={senderOptions().length > 0}>
      <FilterCombobox
        label="From"
        options={senderOptions()}
        active={activeSenderFilter()}
        onChange={handleSenderChange}
        placeholder="Search contacts..."
        virtualized
      />
    </Show>
  );
};

export const HasCalendarInviteFilter = () => {
  const calendarInviteOptions: Option[] = [
    { value: 'has-calendar-invite', label: 'Has calendar invite' },
  ];

  const calendarInvite = useFilterOptions(calendarInviteOptions);

  return (
    <FilterChipGroup
      options={calendarInviteOptions}
      active={calendarInvite.active()}
      onChange={calendarInvite.onChange}
    />
  );
};

export const HasAttachmentFilter = () => {
  const attachmentOptions: Option[] = [
    { value: 'has-attachment', label: 'Has attachment' },
  ];

  const attachment = useFilterOptions(attachmentOptions, { target: 'and' });

  return (
    <FilterChipGroup
      options={attachmentOptions}
      active={attachment.active()}
      onChange={attachment.onChange}
    />
  );
};

export const AttachmentTypeFilter = () => {
  const attachmentTypeOptions: Option[] = [
    {
      value: 'attachment-pdf',
      label: 'PDFs',
      icon: () => <FilePdfIcon class="size-3.5" />,
    },
    {
      value: 'attachment-image',
      label: 'Images',
      icon: () => <FileImageIcon class="size-3.5" />,
    },
    {
      value: 'attachment-document',
      label: 'Documents',
      icon: () => <FileIcon class="size-3.5" />,
    },
  ];

  const attachmentType = useFilterOptions(attachmentTypeOptions);

  return (
    <FilterChipGroup
      options={attachmentTypeOptions}
      active={attachmentType.active()}
      onChange={attachmentType.onChange}
    />
  );
};
