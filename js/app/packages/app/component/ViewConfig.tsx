import {
  ENABLE_FRECENCY,
  ENABLE_TASKS_TABS,
} from '@core/constant/featureFlags';
import {
  DEFAULT_VIEWS,
  type DefaultView,
  type ViewId,
  type ViewLabel,
} from '@core/types/view';
import type { WithCustomUserInput } from '@core/user';
import type { DeepPartial } from '@core/util/withRequired';
import {
  type EntityData,
  type ExpandedEntityType,
  isTaskEntity,
  queryKeys,
  type WithNotification,
} from '@macro-entity';
import {
  markNotificationsForEntityAsDone,
  type NotificationSource,
} from '@notifications';
import { emailClient } from '@service-email/client';
import stringify from 'json-stable-stringify';
import { queryClient } from '../../macro-entity/src/queries/client';
import type { PropertyFilter } from './PropertyFilterTypes';
import type { SoupContext } from './SoupContext';

// for custom views that extend the unified list view
export type ViewType = 'project';

export type ViewData = {
  id: ViewId;
  view: ViewLabel;
  viewType?: ViewType;
  selectedEntity: EntityData | undefined;
  scrollOffset: number | undefined;
  initialConfig: string | undefined;
  hasUserInteractedEntity: boolean;
  searchText: string | undefined;
  multiSelectEntities: EntityData[];
} & ViewConfigBase;

/** maps view id to view data */
export type ViewDataMap = Record<ViewId, ViewData>;

export const KNOWN_FILE_TYPES = [
  'md',
  'code',
  'image',
  'canvas',
  'pdf',
] as const;

export type DocumentTypeFilter =
  | 'md'
  | 'code'
  | 'image'
  | 'canvas'
  | 'pdf'
  | 'unknown';

export type FilterOptions = {
  notificationFilter: 'all' | 'unread' | 'notDone';
  importantFilter: boolean;
  typeFilter: ExpandedEntityType[];
  documentTypeFilter: DocumentTypeFilter[];
  projectFilter?: string;
  fromFilter?: WithCustomUserInput<'user' | 'contact'>[];
  focusFilters?: ('signal' | 'noise')[];
  unreadOnly?: boolean;
  /**
   * Further refines `channel` entities:
   * - `people`: direct messages
   * - `groups`: non-DM channels (private / organization / public)
   *
   * Empty array means "no refinement" (i.e. include all channels).
   */
  channelCategoryFilter?: Array<'people' | 'groups'>;
  propertyFilters?: PropertyFilter[];
};

export type SystemSortOption =
  | 'updated_at'
  | 'created_at'
  | 'viewed_at'
  | 'frecency';

export type SortOptions = {
  sortOrder: 'ascending' | 'descending';
} & (
  | { type: 'systemSortOption'; sortBy: SystemSortOption }
  | { type: 'property'; propertyId: string }
);

export type DisplayOptions = {
  layout: 'compact' | 'expanded' | 'visual';
  unrollNotifications: boolean;
  showUnreadIndicator: boolean;
  displayProperties: string[];
  limit?: number;
};

export type HotkeyOptions = {
  e: (
    entity: WithNotification<EntityData>,
    extra?: {
      notificationSource?: NotificationSource;
      soupContext?: SoupContext;
    }
  ) => boolean;
};

export type ViewConfigBase = {
  viewType?: ViewType;
  filters: FilterOptions;
  sort: SortOptions;
  display: DisplayOptions;
};

export type ViewConfigEnhanced = {
  id: ViewId;
  view: ViewLabel;
  searchText?: string;
  hideToolbar?: true;
  onLoadingChange?: (isLoading: boolean) => void;
  hotkeyOptions?: Partial<HotkeyOptions>;
} & ViewConfigBase;

export type ClientFilterContext = {
  soupContext?: SoupContext;
};

export type ClientFilter = {
  id: string;
  predicate: (
    entity: WithNotification<EntityData>,
    ctx?: ClientFilterContext
  ) => boolean;
};

export const VIEWCONFIG_BASE: ViewConfigBase = {
  sort: {
    type: 'systemSortOption',
    sortBy: 'updated_at',
    sortOrder: 'ascending',
  },
  filters: {
    notificationFilter: 'all',
    importantFilter: false,
    typeFilter: [],
    documentTypeFilter: [],
    projectFilter: undefined,
    fromFilter: [],
    focusFilters: [],
    unreadOnly: false,
    channelCategoryFilter: [],
    propertyFilters: [],
  },
  display: {
    layout: 'compact',
    unrollNotifications: false,
    showUnreadIndicator: false,
    displayProperties: [],
    limit: 100,
  },
};

export const PROJECT_VIEWCONFIG_BASE: ViewConfigBase = {
  viewType: 'project',
  sort: {
    type: 'systemSortOption',
    sortBy: 'viewed_at',
    sortOrder: 'descending',
  },
  filters: {
    notificationFilter: 'all',
    importantFilter: false,
    typeFilter: ['document', 'task', 'chat', 'project'],
    documentTypeFilter: [],
    projectFilter: undefined,
    fromFilter: [],
  },
  display: {
    layout: 'compact',
    unrollNotifications: false,
    showUnreadIndicator: true,
    displayProperties: [],
    limit: 100,
  },
};

const ALL_VIEWCONFIG_DEFAULTS = {
  signal: {
    view: 'Signal',
    filters: {
      notificationFilter: 'notDone',
      focusFilters: ['signal'],
    },
    sort: {
      sortBy: 'updated_at',
    },
    display: {
      unrollNotifications: true,
      showUnreadIndicator: true,
    },
    hotkeyOptions: {
      e: (entity, extra) => {
        if (entity.type === 'email') {
          archiveEmail(entity.id, {
            isDone: entity.done,
            optimisticallyExclude: true,
          });
        }
        if (isTaskEntity(entity)) {
          optimisticallyRemoveTaskFromSignal(entity.id);
        }
        if (extra?.notificationSource) {
          console.log('marking notification as done');
          markNotificationsForEntityAsDone(extra.notificationSource, entity);
        }
        return true;
      },
    },
  },
  noise: {
    view: 'Noise',
    filters: {
      notificationFilter: 'notDone',
      focusFilters: ['noise'],
    },
    sort: {
      sortBy: 'updated_at',
    },
    display: {
      unrollNotifications: true,
      showUnreadIndicator: true,
    },
    hotkeyOptions: {
      e: (entity, extra) => {
        if (entity.type === 'email') {
          archiveEmail(entity.id, {
            isDone: entity.done,
            optimisticallyExclude: true,
          });
        }
        if (extra?.notificationSource) {
          markNotificationsForEntityAsDone(extra.notificationSource, entity);
        }
        return true;
      },
    },
  },
  files: {
    view: 'Files',
    filters: {
      typeFilter: ['document'],
    },
  },
  people: {
    view: 'People',
    filters: {
      typeFilter: ['channel'],
    },
    display: {
      showUnreadIndicator: true,
    },
  },
  email: {
    view: 'Email',
    filters: {
      typeFilter: ['email'],
    },
    sort: {
      sortBy: 'updated_at',
    },
    display: {
      showUnreadIndicator: true,
    },
    hotkeyOptions: {
      e: (entity, extra) => {
        if (extra?.soupContext) {
          const {
            emailViewSignal: [emailView],
          } = extra.soupContext;
          if (emailView() === 'inbox') {
            if (entity.type === 'email') {
              archiveEmail(entity.id, {
                isDone: entity.done,
                optimisticallyExclude: true,
              });
            }
            return true;
          }
        }
        if (entity.type === 'email') {
          archiveEmail(entity.id, { isDone: entity.done });
        }
        return true;
      },
    },
  },
  tasks: {
    view: 'Tasks',
    filters: {
      typeFilter: ['task'],
    },
  },
  folders: {
    view: 'Folders',
    filters: {
      typeFilter: ['project'],
    },
  },
  all: {
    view: 'All',
    sort: {
      sortBy: 'viewed_at',
    },
    hotkeyOptions: {
      e: (entity, extra) => {
        if (entity.type === 'email') {
          archiveEmail(entity.id, {
            isDone: entity.done,
            optimisticallyExclude: true,
          });
        }
        if (extra?.notificationSource) {
          markNotificationsForEntityAsDone(extra.notificationSource, entity);
        }
        return true;
      },
    },
  },
} satisfies Record<DefaultView, Omit<DeepPartial<ViewConfigEnhanced>, 'id'>>;

export const VIEWCONFIG_DEFAULTS = Object.fromEntries(
  Object.entries(ALL_VIEWCONFIG_DEFAULTS).filter(([key]) => {
    if (key === 'tasks') return ENABLE_TASKS_TABS;
    return DEFAULT_VIEWS.includes(key as DefaultView);
  })
) as Record<DefaultView, Omit<ViewConfigEnhanced, 'id'>>;

export const VIEWCONFIG_DEFAULTS_IDS = Object.keys(
  VIEWCONFIG_DEFAULTS
) as DefaultView[];
export const VIEWCONFIG_DEFAULTS_IDS_ENUM = Object.fromEntries(
  Object.entries(VIEWCONFIG_DEFAULTS).map(([key]) => {
    return [key, key];
  })
) as Record<DefaultView, string>;

export const VIEWCONFIG_FILTER_SHOW_OPTIONS: readonly FilterOptions['notificationFilter'][] =
  ['all', 'unread', 'notDone'] as const;
export const VIEWCONFIG_FILTER_FILETYPE_OPTIONS: readonly FilterOptions['documentTypeFilter'][number][] =
  ['md', 'code', 'image', 'canvas', 'pdf', 'unknown'] as const;
export const VIEWCONFIG_DISPLAY_LAYOUT_OPTIONS: readonly DisplayOptions['layout'][] =
  ['compact', 'expanded', 'visual'] as const;
export const VIEWCONFIG_SORT_BY: readonly SystemSortOption[] = [
  'updated_at',
  'created_at',
  'viewed_at',
  ...(ENABLE_FRECENCY ? (['frecency'] as const) : []),
] as const;
export const VIEWCONFIG_SORT_ORDER: readonly SortOptions['sortOrder'][] = [
  'ascending',
  'descending',
] as const;
export const VIEWCONFIG_FILTER_DOCUMENT_TYPE_FILTER: readonly FilterOptions['documentTypeFilter'][number][] =
  ['md', 'pdf', 'canvas', 'code', 'image', 'unknown'] as const;
export const VIEWCONFIG_FILTER_ENTITY_TYPE: readonly FilterOptions['typeFilter'][number][] =
  ['channel', 'chat', 'document', 'email', 'project', 'task'] as const;

export async function archiveEmail(
  id: string,
  options: { isDone: boolean; optimisticallyExclude?: boolean }
) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.all.email }),
    queryClient.cancelQueries({ queryKey: queryKeys.all.dss }),
  ]);

  const previousEmail = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.email,
  });
  const previousEmailThreadItemFromDss = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.dss,
  });

  const applyOptimistic = (data?: {
    pages: { items: (EntityData | { data: EntityData })[] }[];
  }) => {
    if (!data) return data;

    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: options.optimisticallyExclude
          ? page.items.filter((item) => {
              if ('data' in item) {
                return item.data.id !== id;
              }
              return item.id !== id;
            })
          : page.items.map((item) => {
              if ('data' in item) {
                return item.data.id === id
                  ? {
                      ...item,
                      data: {
                        ...item.data,
                        inboxVisible: false,
                      },
                    }
                  : item;
              }
              return item.id === id
                ? {
                    ...item,
                    inboxVisible: false,
                  }
                : item;
            }),
      })),
    };
  };

  for (const [key, data] of [
    ...previousEmailThreadItemFromDss,
    ...previousEmail,
  ]) {
    queryClient.setQueryData(key, applyOptimistic(data));
  }

  try {
    // server mutation
    await emailClient.flagArchived({ value: !options.isDone, id });
  } catch (_err) {
    // rollback on error
    for (const [key, data] of previousEmail) {
      queryClient.setQueryData(key, data);
    }
    for (const [key, data] of previousEmailThreadItemFromDss) {
      queryClient.setQueryData(key, data);
    }
  } finally {
    // revalidate
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
      queryClient.invalidateQueries({ queryKey: queryKeys.all.dss }),
    ]);
  }
}

/**
 * Optimistically removes a task from the DSS queries (signal view).
 * This is used when marking a task as done in the signal view to immediately
 * remove it from the list before the query refetches.
 */
export async function optimisticallyRemoveTaskFromSignal(id: string) {
  await queryClient.cancelQueries({ queryKey: queryKeys.all.dss });

  const previousDss = queryClient.getQueriesData<{
    pages: { items: (EntityData | { data: EntityData })[] }[];
  }>({
    queryKey: queryKeys.all.dss,
  });

  // Filter out the task with the given ID
  for (const [key, data] of previousDss) {
    if (!data) continue;

    const updatedData = {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => {
          if ('data' in item) {
            return item.data.id !== id;
          }
          return item.id !== id;
        }),
      })),
    };

    queryClient.setQueryData(key, updatedData);
  }

  // Note: We don't rollback on error since the mutation happens separately
  // via setPropertyStatusCompleteMutation. The query invalidation will
  // sync the state after the mutation completes.
}

/**
 * Normalizes an object by treating [], undefined, null, or missing properties as equivalent.
 * Removes properties that are empty arrays, undefined, or null, and recursively processes nested objects.
 */
const normalizeConfig = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  if (Array.isArray(obj)) {
    // Empty arrays are treated as undefined (missing property)
    if (obj.length === 0) {
      return undefined;
    }
    // For arrays with items, normalize each item recursively but keep the array structure
    return obj.map((item) => normalizeConfig(item));
  }

  if (typeof obj === 'object') {
    const normalized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const normalizedValue = normalizeConfig(value);
      // Only include the property if it's not undefined after normalization
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue;
      }
    }
    return normalized;
  }

  return obj;
};

/**
 * Deep comparison that treats [], undefined, null, or missing properties as equivalent.
 */
export const isConfigEqual = (a: any, b: any): boolean => {
  const normalizedA = normalizeConfig(a);
  const normalizedB = normalizeConfig(b);

  // Use stringify for comparison after normalization
  return stringify(normalizedA) === stringify(normalizedB);
};
