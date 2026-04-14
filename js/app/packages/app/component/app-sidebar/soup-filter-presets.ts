import {
  EXCLUDE,
  QUERY_FILTERS,
} from '@app/component/next-soup/filters/query-filters';
import type {
  FilterID,
  ScopedFilterId,
} from '@app/component/next-soup/filters';
import {
  applyInboxQueryFilters,
  applyOtherQueryFilters,
} from '@app/component/next-soup/filters/inbox-query-filters';
import type { ListView } from '@app/constants/list-views';
import type { SoupBody } from '@queries/soup/items';
import { SharedEmailFilter } from '@service-storage/generated/schemas';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';

/** Shared query filters for the "Signal" tab across Inbox and Email views. */
export const SIGNAL_QUERY_FILTERS = {
  email_filters: {
    importance: true as const,
    shared: SharedEmailFilter.exclude,
  },
  emailView: 'inbox' as const,
};

/** Shared query filters for the "Noise" tab across Inbox and Email views. */
export const NOISE_QUERY_FILTERS = {
  email_filters: {
    importance: false as const,
    shared: SharedEmailFilter.exclude,
  },
  emailView: 'inbox' as const,
};

export type SoupFiltersPreset = {
  queryFilters: SoupBody;
  /** Client filters to apply. Supports scoped filters: `{ id: 'filter-id', targets: ['pf'] }` */
  clientFilters: ScopedFilterId<FilterID>[];
};

// Tab preset configuration types
export type PresetContext = {
  userId: string | undefined;
  email: string | undefined;
};

export type TabPresetResolver = (
  ctx: PresetContext
) => SoupFiltersPreset | undefined;

export type TabConfig = Record<string, TabPresetResolver>;

export type ViewTabConfig = {
  default: string;
  tabs: TabConfig;
};

export const VIEW_TAB_PRESETS: Record<ListView, ViewTabConfig> = {
  inbox: {
    default: 'signal',
    tabs: {
      signal: () => {
        const filters = applyInboxQueryFilters({
          document_filters: { is_email_attachment: false },
        });
        return {
          queryFilters: {
            ...filters,
            ...SIGNAL_QUERY_FILTERS,
          },
          clientFilters: ['inbox'],
        };
      },
      noise: () => {
        const filters = applyOtherQueryFilters({
          document_filters: { is_email_attachment: false },
        });
        return {
          queryFilters: {
            ...filters,
            ...NOISE_QUERY_FILTERS,
          },
          clientFilters: ['noise'],
        };
      },
      all: () => ({
        queryFilters: {
          document_filters: { is_email_attachment: false },
          email_filters: { shared: SharedEmailFilter.include },
          emailView: 'all',
        },
        clientFilters: ['explicit-noise'],
      }),
    },
  },
  agents: {
    default: 'owned',
    tabs: {
      owned: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.agent,
            chat_filters: { owners: [ctx.userId] },
          },
          clientFilters: ['agent'],
        };
      },
      running: () => ({
        queryFilters: QUERY_FILTERS.agent,
        clientFilters: ['agent', { id: 'owned-entity', targets: ['cf'] }],
      }),
      shared: () => ({
        queryFilters: QUERY_FILTERS.agent,
        clientFilters: ['agent', { id: 'shared-entity', targets: ['cf'] }],
      }),
    },
  },
  mail: {
    default: 'important',
    tabs: {
      important: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          ...SIGNAL_QUERY_FILTERS,
        },
        clientFilters: ['email', 'no-drafts'],
      }),
      noise: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          ...NOISE_QUERY_FILTERS,
        },
        clientFilters: ['email', 'no-drafts'],
      }),
      drafts: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          email_filters: { shared: SharedEmailFilter.exclude },
          emailView: 'drafts',
        },
        clientFilters: ['email-drafts'],
      }),
      sent: (ctx) => {
        if (!ctx.email) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.email,
            email_filters: {
              senders: [ctx.email],
              shared: SharedEmailFilter.exclude,
            },
            emailView: 'sent',
          },
          clientFilters: ['email', 'no-drafts'],
        };
      },
      shared: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          email_filters: { shared: SharedEmailFilter.only },
          emailView: 'all',
        },
        clientFilters: ['email', { id: 'shared-entity', targets: ['ef'] }],
      }),
      all: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          email_filters: { shared: SharedEmailFilter.include },
          emailView: 'all',
        },
        clientFilters: ['email'],
      }),
    },
  },
  documents: {
    default: 'owned',
    tabs: {
      owned: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.documentAndFile,
            document_filters: {
              ...QUERY_FILTERS.documentAndFile.document_filters,
              is_email_attachment: false,
              owners: [ctx.userId],
            },
            project_filters: { project_ids: EXCLUDE },
          },
          clientFilters: [
            'document-or-file',
            { id: 'owned-entity', targets: ['df'] },
          ],
        };
      },
      shared: () => ({
        queryFilters: {
          ...QUERY_FILTERS.documentAndFile,
          document_filters: {
            ...QUERY_FILTERS.documentAndFile.document_filters,
            is_email_attachment: false,
          },
          project_filters: { project_ids: EXCLUDE },
        },
        clientFilters: [
          'document-or-file',
          { id: 'shared-entity', targets: ['ef'] },
        ],
      }),
      attachments: () => ({
        queryFilters: {
          ...QUERY_FILTERS.documentAndFile,
          document_filters: {
            is_email_attachment: true,
          },
          project_filters: { project_ids: EXCLUDE },
        },
        clientFilters: ['document-or-file'],
      }),
      all: () => ({
        queryFilters: {
          ...QUERY_FILTERS.documentAndFile,
          project_filters: { project_ids: EXCLUDE },
        },
        clientFilters: ['document-or-file'],
      }),
    },
  },
  tasks: {
    default: 'assigned-to-me',
    tabs: {
      'assigned-to-me': (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.task,
            property_filters: [
              {
                property_definition_id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
                entity_type: 'TASK',
                entity_ids: [ctx.userId],
              },
              {
                property_definition_id: SYSTEM_PROPERTY_IDS.STATUS,
                entity_type: 'TASK',
                option_ids: [
                  PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
                  PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
                  PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
                ],
              },
            ],
          },
          clientFilters: ['task', 'assigned-to', 'active-task'],
        };
      },
      'created-by-me': (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.task,
            document_filters: {
              ...QUERY_FILTERS.task.document_filters,
              owners: [ctx.userId],
            },
          },
          clientFilters: [
            'task',
            'active-task',
            { id: 'owned-entity', targets: ['df'] },
          ],
        };
      },
      all: () => ({
        queryFilters: QUERY_FILTERS.task,
        clientFilters: ['task'],
      }),
    },
  },
  channels: {
    default: 'recent',
    tabs: {
      recent: () => ({
        queryFilters: {
          ...QUERY_FILTERS.channels,
          channel_filters: { importance: true },
        },
        clientFilters: ['channels'],
      }),
      people: () => ({
        queryFilters: QUERY_FILTERS.people,
        clientFilters: ['people'],
      }),
      teams: () => ({
        queryFilters: QUERY_FILTERS.teams,
        clientFilters: ['teams'],
      }),
    },
  },
  folders: {
    default: 'owned',
    tabs: {
      owned: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.folders,
            project_filters: { owners: [ctx.userId] },
          },
          clientFilters: ['folders', { id: 'owned-entity', targets: ['pf'] }],
        };
      },
      all: () => ({
        queryFilters: QUERY_FILTERS.folders,
        clientFilters: ['folders'],
      }),
    },
  },
  search: {
    default: 'all',
    tabs: {
      all: () => ({
        queryFilters: {
          ...QUERY_FILTERS.default,
        },
        clientFilters: [],
      }),
    },
  },
};

/** Views whose default tab requires user context */
type ContextRequiredView = 'agents' | 'documents' | 'tasks' | 'folders';

/** Views whose default tab works without user context */
type ContextOptionalView = Exclude<ListView, ContextRequiredView>;

/**
 * Returns the default filter preset for a list view.
 * Uses the view's default tab, falling back to the first available tab
 * if the default requires context values that aren't provided.
 *
 * @param view - The list view to get the preset for
 * @param ctx - User context (required for agents, documents, tasks, folders)
 */
export function getDefaultListViewPreset(
  view: ContextRequiredView,
  ctx: PresetContext
): SoupFiltersPreset;
export function getDefaultListViewPreset(
  view: ContextOptionalView,
  ctx?: PresetContext
): SoupFiltersPreset;
export function getDefaultListViewPreset(
  view: ListView,
  ctx: PresetContext = { userId: undefined, email: undefined }
): SoupFiltersPreset {
  const config = VIEW_TAB_PRESETS[view];
  const defaultResolver = config.tabs[config.default];

  // Try default tab with provided context
  const resolved = defaultResolver(ctx);
  if (resolved) return resolved;

  // Fallback: find first tab that works with provided context
  for (const resolver of Object.values(config.tabs)) {
    const fallback = resolver(ctx);
    if (fallback) return fallback;
  }

  // Last resort: empty filters
  return { queryFilters: {}, clientFilters: [] };
}
