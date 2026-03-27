import {
  EXCLUDE,
  QUERY_FILTERS,
} from '@app/component/next-soup/filters/query-filters';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import {
  applyInboxQueryFilters,
  applyOtherQueryFilters,
} from '@app/component/next-soup/filters/inbox-query-filters';
import type { ListView } from '@app/constants/list-views';
import type { SoupBody } from '@queries/soup/items';
import { SharedEmailFilter } from '@service-storage/generated/schemas';

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
  clientFilters: {
    and?: FilterID[];
    or?: FilterID[];
  };
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
          clientFilters: { and: ['signal', 'not-done'] },
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
          clientFilters: { and: ['noise', 'not-done'] },
        };
      },
      all: () => ({
        queryFilters: {
          document_filters: { is_email_attachment: false },
          email_filters: { shared: SharedEmailFilter.include },
          emailView: 'all',
        },
        clientFilters: { and: ['explicit-noise'] },
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
          clientFilters: { and: ['agent'] },
        };
      },
      running: () => ({
        queryFilters: QUERY_FILTERS.agent,
        clientFilters: { and: ['agent'] },
      }),
      shared: () => ({
        queryFilters: QUERY_FILTERS.agent,
        clientFilters: { and: ['agent', 'shared-agent'] },
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
        clientFilters: { and: ['email', 'no-drafts'] },
      }),
      noise: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          ...NOISE_QUERY_FILTERS,
        },
        clientFilters: { and: ['email', 'no-drafts'] },
      }),
      drafts: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          email_filters: { shared: SharedEmailFilter.exclude },
          emailView: 'drafts',
        },
        clientFilters: { and: ['email-drafts'] },
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
          clientFilters: { and: ['email', 'no-drafts'] },
        };
      },
      shared: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          email_filters: { shared: SharedEmailFilter.only },
          emailView: 'all',
        },
        clientFilters: { and: ['email'] },
      }),
      all: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          email_filters: { shared: SharedEmailFilter.include },
          emailView: 'all',
        },
        clientFilters: { and: ['email'] },
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
          clientFilters: { and: ['not-task'] },
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
        clientFilters: { and: ['not-task', 'shared-entity'] },
      }),
      attachments: () => ({
        queryFilters: {
          ...QUERY_FILTERS.documentAndFile,
          document_filters: {
            is_email_attachment: true,
          },
          project_filters: { project_ids: EXCLUDE },
        },
        clientFilters: { and: ['not-task'] },
      }),
      all: () => ({
        queryFilters: {
          ...QUERY_FILTERS.documentAndFile,
          project_filters: { project_ids: EXCLUDE },
        },
        clientFilters: { and: ['not-task'] },
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
            document_filters: {
              ...QUERY_FILTERS.task.document_filters,
              owners: [ctx.userId],
            },
          },
          clientFilters: { and: ['task', 'assigned-to', 'active-task'] },
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
          clientFilters: { and: ['task', 'active-task'] },
        };
      },
      all: () => ({
        queryFilters: QUERY_FILTERS.task,
        clientFilters: { and: ['task'] },
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
        clientFilters: { and: ['channels'] },
      }),
      people: () => ({
        queryFilters: QUERY_FILTERS.people,
        clientFilters: { and: ['people'] },
      }),
      teams: () => ({
        queryFilters: QUERY_FILTERS.teams,
        clientFilters: { and: ['teams'] },
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
            channel_filters: { channel_ids: EXCLUDE },
            chat_filters: { chat_ids: EXCLUDE },
            email_filters: { recipients: EXCLUDE },
            document_filters: { document_ids: EXCLUDE },
            project_filters: { owners: [ctx.userId] },
          },
          clientFilters: { and: ['folders'] },
        };
      },
      all: () => ({
        queryFilters: {
          channel_filters: { channel_ids: EXCLUDE },
          chat_filters: { chat_ids: EXCLUDE },
          email_filters: { recipients: EXCLUDE },
          document_filters: { document_ids: EXCLUDE },
          project_filters: {},
        },
        clientFilters: { and: ['folders'] },
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
        clientFilters: { and: [], or: [] },
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
 * @param ctx - User context (required for agents, documents, tasks, files)
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
  return { queryFilters: {}, clientFilters: {} };
}
