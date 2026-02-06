import {
  isTaskEntity,
  type EntityData,
  type WithNotification,
} from '@macro-entity';
import {
  signalFilter,
  noiseFilter,
  explicitNoiseFilter,
} from './signal-filters';
import {
  type EntityWithValidIcon,
  getIconConfig,
} from '@core/component/EntityIcon';
import type {
  SoupItemsQueryArgs,
  SoupItemsQueryFilters,
} from '@queries/soup/items';
import { codeFileExtensions } from '@block-code/util/languageSupport';

/**
 * Unread filter - entity has unread content.
 *
 * Entity-specific logic:
 * - Emails: Uses `isRead` boolean field
 * - Everything else: Has at least one notification with viewedAt === null
 */
export function unreadFilter(entity: EnhancedEntity): boolean {
  if (entity.type === 'email') {
    return !entity.isRead;
  }
  return entity.notifications?.()?.some((n) => !n.viewedAt) ?? false;
}

/**
 * NotDone filter - entity has outstanding items.
 *
 * Entity-specific logic:
 * - Emails: Uses `done` field (derived from !inboxVisible - email is "not done" when in inbox)
 * - Everything else: Has at least one notification with done === false
 */
export function notDoneFilter(entity: WithNotification<EntityData>) {
  if (entity.type === 'email') return !entity.done;
  // Tasks are handled by signalFilter based on assignee/status, not notifications
  if (isTaskEntity(entity)) return true;

  return (
    !!entity.notifications && entity.notifications().some(({ done }) => !done)
  );
}

/** Filter predicate function */
export type FilterPredicate<T> = (entity: T) => boolean;

/** Filter configuration */
export type FilterConfig<T> = {
  readonly id: string;
  readonly label: string;
  readonly predicate: FilterPredicate<T>;
  readonly group?: string;
};

/** Filter group configuration */
export type FilterGroup = {
  readonly id: string;
  readonly allowMultiple?: boolean;
};

/** Filter group configurations */
export const FILTER_GROUPS: readonly FilterGroup[] = [
  { id: 'focus', allowMultiple: false },
  { id: 'type', allowMultiple: false },
];

type EnhancedEntity = WithNotification<EntityData>;

/** Document filter (markdown, canvas) - excludes tasks */
export function documentFilter(entity: EntityData): boolean {
  if (entity.type !== 'document') return false;
  if (entity.subType?.type === 'task') return false;
  const fileType = entity.fileType ?? '';
  return fileType === 'md' || fileType === 'canvas';
}

/** Task filter */
export function taskFilter(entity: EntityData): boolean {
  return entity.type === 'document' && entity.subType?.type === 'task';
}

/** Email filter */
export function emailFilter(entity: EntityData): boolean {
  return entity.type === 'email';
}

/** People filter (direct messages) */
export function peopleFilter(entity: EntityData): boolean {
  return entity.type === 'channel' && entity.channelType === 'direct_message';
}

/** Teams filter (group channels) */
export function teamsFilter(entity: EntityData): boolean {
  return entity.type === 'channel' && entity.channelType !== 'direct_message';
}

/** Chat/agent filter */
export function agentFilter(entity: EntityData): boolean {
  return entity.type === 'chat';
}

/** Project/folder filter */
export function projectFilter(entity: EntityData): boolean {
  return entity.type === 'project';
}

/** File filter (non-markdown documents) */
export function fileFilter(entity: EntityData): boolean {
  if (entity.type !== 'document') return false;
  const fileType = entity.fileType ?? '';
  return !['md', 'canvas'].includes(fileType);
}

export function teamsAndPeopleFilter(entity: EntityData): boolean {
  if (entity.type !== 'channel') return false;

  return true;
}

export const SOUP_FILTERS = [
  // Focus filters (mutually exclusive)
  {
    id: 'signal',
    label: 'Inbox',
    predicate: signalFilter,
    group: 'focus',
  },
  {
    id: 'noise',
    label: 'Other',
    predicate: noiseFilter,
    group: 'focus',
  },
  {
    id: 'explicit-noise',
    label: 'Explicit Noise',
    predicate: (entity: EntityData) => !explicitNoiseFilter(entity),
    group: 'focus',
  },

  // Notification filters
  {
    id: 'unread',
    label: 'Unread',
    predicate: unreadFilter,
  },
  {
    id: 'not-done',
    label: 'Not done',
    predicate: notDoneFilter,
  },

  // Entity type filters (mutually exclusive)
  {
    id: 'document',
    label: 'Docs',
    predicate: documentFilter,
    group: 'type',
  },
  {
    id: 'agent',
    label: 'Agents',
    predicate: agentFilter,
    group: 'type',
  },
  {
    id: 'people',
    label: 'People',
    predicate: peopleFilter,
    group: 'type',
  },
  {
    id: 'teams',
    label: 'Teams',
    predicate: teamsFilter,
    group: 'type',
  },
  {
    id: 'task',
    label: 'Tasks',
    predicate: taskFilter,
    group: 'type',
  },
  {
    id: 'email',
    label: 'Mail',
    predicate: emailFilter,
    group: 'type',
  },
  {
    id: 'file',
    label: 'Files',
    predicate: fileFilter,
    group: 'type',
  },
  {
    id: 'teams-and-people',
    label: 'Groups',
    predicate: teamsAndPeopleFilter,
    group: 'type',
  },
] as const;

export type FilterID = (typeof SOUP_FILTERS)[number]['id'];

const ENTITY_TYPE_FILTERS = [
  'document',
  'task',
  'email',
  'people',
  'teams',
  'agent',
  'file',
] as const;

type EntityTypeFilters = (typeof ENTITY_TYPE_FILTERS)[number];

export const isEntityTypeFilter = (
  filter: FilterConfig<EntityData>
): filter is Extract<
  (typeof SOUP_FILTERS)[number],
  { readonly id: EntityTypeFilters }
> => {
  return ENTITY_TYPE_FILTERS.includes(filter.id as EntityTypeFilters);
};

export const ENTITY_TYPE_FILTER_CONFIGS = SOUP_FILTERS.filter((f) =>
  isEntityTypeFilter(f)
);

const ENTITY_TYPE_TO_ICON_TYPE: Record<EntityTypeFilters, EntityWithValidIcon> =
  {
    document: 'md',
    email: 'email',
    task: 'task',
    people: 'channel',
    teams: 'direct_message',
    agent: 'chat',
    file: 'project',
  };

export const getEntityTypeFilterIcon = (filter: EntityTypeFilters) => {
  return getIconConfig(ENTITY_TYPE_TO_ICON_TYPE[filter]);
};

export const getFilterWithID = (filterID: FilterID) => {
  const found = SOUP_FILTERS.find((f) => f.id === filterID);

  if (!found) return;

  return found;
};

export const FOLDER_DOCUMENT_TYPES = [
  'code',
  'image',
  'pdf',
  'unknown',
] as const;

export const getFolderFileTypes = (type: 'soup' | 'search') => {
  return FOLDER_DOCUMENT_TYPES.flatMap((fileType) => {
    if (fileType === 'code')
      return type === 'soup' ? ['assoc:code'] : codeFileExtensions;
    if (fileType === 'image')
      return type === 'soup' ? ['assoc:image'] : [NIL_UUID];
    if (fileType === 'unknown')
      return type === 'soup' ? ['assoc:other'] : [NIL_UUID];
    return [fileType];
  });
};

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const buildDefaultValue = (entityTypes: string[], required: string[]) => {
  const hasNoEntityTypes = entityTypes.length === 0;

  const hasSomeRequiredType = required.some((t) => entityTypes.includes(t));

  if (hasSomeRequiredType || hasNoEntityTypes) {
    return [];
  }

  return [NIL_UUID];
};

export const buildDssFiltersRequest = (
  filters: FilterConfig<EntityData>[],
  context?: {
    extra?: SoupItemsQueryFilters;
    isSearchActive?: boolean;
    emailActive?: boolean;
  }
): SoupItemsQueryArgs['body'] => {
  const entityTypes = filters
    .filter((f) => ENTITY_TYPE_FILTERS.includes(f.id as EntityTypeFilters))
    .map((f) => f.id);

  const {
    channel_filters,
    document_filters,
    chat_filters,
    email_filters,
    project_filters,
  } = context?.extra ?? {};

  return {
    channel_filters: {
      ...channel_filters,
      channel_ids:
        channel_filters?.channel_ids ??
        buildDefaultValue(entityTypes, ['teams', 'people']),
    },
    document_filters: {
      ...document_filters,
      document_ids:
        document_filters?.document_ids ??
        buildDefaultValue(entityTypes, ['file', 'document', 'task']),
      project_ids: document_filters?.project_ids ?? [],
      file_types: document_filters?.file_types ?? [],
    },
    chat_filters: {
      ...chat_filters,
      chat_ids:
        chat_filters?.chat_ids ?? buildDefaultValue(entityTypes, ['agent']),
      project_ids: chat_filters?.project_ids ?? [],
    },
    email_filters: {
      ...email_filters,
      recipients:
        email_filters?.recipients ??
        (context?.emailActive &&
        !context.isSearchActive &&
        (entityTypes.includes('email') || entityTypes.length === 0)
          ? []
          : [NIL_UUID]),
    },
    project_filters: {
      ...project_filters,
      project_ids:
        project_filters?.project_ids ??
        buildDefaultValue(entityTypes, ['file']),
    },
    emailView: 'all',
  };
};
