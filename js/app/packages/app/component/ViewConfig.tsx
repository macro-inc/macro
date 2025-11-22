import {
  VIEWS,
  type View,
  type ViewId,
  type ViewLabel,
} from '@core/types/view';
import type { WithCustomUserInput } from '@core/user';
import type { DeepPartial } from '@core/util/withRequired';
import {
  type EntityData,
  type EntityType,
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
import type { UnifiedListContext } from './SoupContext';

// for custom views that extend the unified list view
export type ViewType = 'project';

export type ViewData = {
  id: ViewId;
  view: ViewLabel;
  viewType?: ViewType;
  highlightedId: string | undefined;
  selectedEntity: EntityData | undefined;
  scrollOffset: number | undefined;
  initialConfig: string | undefined;
  hasUserInteractedEntity: boolean;
  searchText: string | undefined;
  selectedEntities: EntityData[];
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
  typeFilter: EntityType[];
  documentTypeFilter: DocumentTypeFilter[];
  projectFilter?: string;
  emailFilter?: 'inbox' | 'sent' | 'drafts' | 'all';
  fromFilter?: WithCustomUserInput<'user' | 'contact'>[];
};

export type SortOptions = {
  sortBy: 'updated_at' | 'created_at' | 'viewed_at' | 'frecency';
  sortOrder: 'ascending' | 'descending';
};

export type DisplayOptions = {
  layout: 'compact' | 'expanded' | 'visual';
  unrollNotifications: boolean;
  showUnreadIndicator: boolean;
  limit?: number;
};

export type HotkeyOptions = {
  e: (
    entity: WithNotification<EntityData>,
    extra?: {
      notificationSource?: NotificationSource;
      soupContext?: UnifiedListContext;
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

export const VIEWCONFIG_BASE: ViewConfigBase = {
  sort: {
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
  },
  display: {
    layout: 'compact',
    unrollNotifications: false,
    showUnreadIndicator: false,
    limit: 100,
  },
};

export const PROJECT_VIEWCONFIG_BASE: ViewConfigBase = {
  viewType: 'project',
  sort: {
    sortBy: 'viewed_at',
    sortOrder: 'descending',
  },
  filters: {
    notificationFilter: 'all',
    importantFilter: false,
    typeFilter: ['document', 'chat', 'project'],
    documentTypeFilter: [],
    projectFilter: undefined,
    fromFilter: [],
  },
  display: {
    layout: 'compact',
    unrollNotifications: false,
    showUnreadIndicator: true,
    limit: 100,
  },
};

const ALL_VIEWCONFIG_DEFAULTS = {
  inbox: {
    view: 'Inbox',
    filters: {
      notificationFilter: 'notDone',
      emailFilter: 'sent',
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
          archiveEmail(entity.id, { isDone: entity.done });
        }
        if (extra?.notificationSource) {
          markNotificationsForEntityAsDone(extra.notificationSource, entity);
        }
        return true;
      },
    },
  },
  emails: {
    view: 'Emails',
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
  comms: {
    view: 'Comms',
    filters: {
      typeFilter: ['channel'],
    },
    display: {
      showUnreadIndicator: true,
    },
  },
  docs: {
    view: 'Docs',
    filters: {
      typeFilter: ['document'],
    },
  },
  ai: {
    view: 'Ai',
    filters: {
      typeFilter: ['chat'],
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
      e: (entity: EntityData) => {
        if (entity.type === 'email') {
          archiveEmail(entity.id, { isDone: entity.done });
        }
        return true;
      },
    },
  },
} satisfies Record<View, Omit<DeepPartial<ViewConfigEnhanced>, 'id'>>;

export const VIEWCONFIG_DEFAULTS = Object.fromEntries(
  Object.entries(ALL_VIEWCONFIG_DEFAULTS).filter(([key]) =>
    VIEWS.includes(key as View)
  )
) as Record<View, Omit<ViewConfigEnhanced, 'id'>>;

export const VIEWCONFIG_DEFAULTS_IDS = Object.keys(
  VIEWCONFIG_DEFAULTS
) as View[];
export const VIEWCONFIG_DEFAULTS_IDS_ENUM = Object.fromEntries(
  Object.entries(VIEWCONFIG_DEFAULTS).map(([key]) => {
    return [key, key];
  })
) as Record<View, string>;

export const VIEWCONFIG_FILTER_SHOW_OPTIONS: readonly FilterOptions['notificationFilter'][] =
  ['all', 'unread', 'notDone'] as const;
export const VIEWCONFIG_FILTER_FILETYPE_OPTIONS: readonly FilterOptions['documentTypeFilter'][number][] =
  ['md', 'code', 'image', 'canvas', 'pdf', 'unknown'] as const;
export const VIEWCONFIG_DISPLAY_LAYOUT_OPTIONS: readonly DisplayOptions['layout'][] =
  ['compact', 'expanded', 'visual'] as const;
export const VIEWCONFIG_SORT_BY: readonly SortOptions['sortBy'][] = [
  'updated_at',
  'created_at',
  'viewed_at',
  'frecency',
] as const;
export const VIEWCONFIG_SORT_ORDER: readonly SortOptions['sortOrder'][] = [
  'ascending',
  'descending',
] as const;
export const VIEWCONFIG_FILTER_EMAIL_OPTIONS: readonly NonNullable<
  FilterOptions['emailFilter']
>[] = ['inbox', 'sent', 'drafts', 'all'] as const;
export const VIEWCONFIG_FILTER_DOCUMENT_TYPE_FILTER: readonly FilterOptions['documentTypeFilter'][number][] =
  ['md', 'code', 'image', 'canvas', 'pdf', 'unknown'] as const;
export const VIEWCONFIG_FILTER_ENTITY_TYPE: readonly FilterOptions['typeFilter'][number][] =
  ['channel', 'chat', 'document', 'email', 'project'] as const;

export async function archiveEmail(
  id: string,
  options: { isDone: boolean; optimisticallyExclude?: boolean }
) {
  // optimistic update
  await queryClient.cancelQueries({ queryKey: queryKeys.all.email });

  const previous = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.email,
  });

  const applyOptimistic = (data?: { pages: { items: EntityData[] }[] }) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: options.optimisticallyExclude
          ? page.items.filter((item) => item.id !== id)
          : page.items.map((item) => {
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

  for (const [key, data] of previous) {
    queryClient.setQueryData(key, applyOptimistic(data));
  }

  try {
    // server mutation
    await emailClient.flagArchived({ value: !options.isDone, id });
  } catch (_err) {
    // rollback on error
    for (const [key, data] of previous) {
      queryClient.setQueryData(key, data);
    }
  } finally {
    // revalidate
    await queryClient.invalidateQueries({ queryKey: queryKeys.all.email });
  }
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
