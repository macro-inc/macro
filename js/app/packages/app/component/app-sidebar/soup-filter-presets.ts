import {
  QUERY_FILTERS,
  type FilterID,
} from '@app/component/next-soup/filters/filters';
import {
  applyInboxQueryFilters,
  applyOtherQueryFilters,
} from '@app/component/next-soup/filters/inbox-query-filters';
import type { ListView } from '@app/constants/list-views';
import type { SoupItemsQueryFilters } from '@queries/soup/items';

export type SoupFiltersPreset = {
  queryFilters: SoupItemsQueryFilters;
  clientFilters: FilterID[];
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
      signal: () => ({
        queryFilters: applyInboxQueryFilters({}),
        clientFilters: ['signal', 'not-done'],
      }),
      noise: () => ({
        queryFilters: applyOtherQueryFilters({}),
        clientFilters: ['noise', 'not-done'],
      }),
      all: () => ({
        queryFilters: {},
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
        clientFilters: ['agent'],
      }),
      shared: () => ({
        queryFilters: QUERY_FILTERS.agent,
        clientFilters: ['agent'],
      }),
    },
  },
  mail: {
    default: 'important',
    tabs: {
      important: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          email_filters: { importance: true },
        },
        clientFilters: ['email', 'no-drafts'],
      }),
      noise: () => ({
        queryFilters: {
          ...QUERY_FILTERS.email,
          email_filters: { importance: false },
        },
        clientFilters: ['email', 'no-drafts'],
      }),
      drafts: () => ({
        queryFilters: QUERY_FILTERS.email,
        clientFilters: ['email-drafts'],
      }),
      sent: (ctx) => {
        if (!ctx.email) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.email,
            email_filters: { senders: [ctx.email] },
          },
          clientFilters: ['email', 'no-drafts'],
        };
      },
    },
  },
  documents: {
    default: 'owned',
    tabs: {
      owned: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.document,
            document_filters: { owners: [ctx.userId] },
          },
          clientFilters: ['document'],
        };
      },
      shared: () => ({
        queryFilters: QUERY_FILTERS.document,
        clientFilters: ['document', 'shared-entity'],
      }),
      all: () => ({
        queryFilters: QUERY_FILTERS.document,
        clientFilters: ['document'],
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
            document_filters: { owners: [ctx.userId] },
          },
          clientFilters: ['task', 'assigned-to'],
        };
      },
      'created-by-me': (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.task,
            document_filters: { owners: [ctx.userId] },
          },
          clientFilters: ['task'],
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
  files: {
    default: 'owned',
    tabs: {
      owned: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          queryFilters: {
            ...QUERY_FILTERS.file,
            document_filters: {
              ...QUERY_FILTERS.file.document_filters,
              owners: [ctx.userId],
            },
            project_filters: { owners: [ctx.userId] },
          },
          clientFilters: ['file-folder'],
        };
      },
      shared: () => ({
        queryFilters: QUERY_FILTERS.file,
        clientFilters: ['file-folder', 'shared-entity'],
      }),
      all: () => ({
        queryFilters: {
          ...QUERY_FILTERS.file,
          project_filters: {},
        },
        clientFilters: ['file-folder'],
      }),
    },
  },
};

/** Views whose default tab requires user context */
type ContextRequiredView = 'agents' | 'documents' | 'tasks' | 'files';

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
  return { queryFilters: {}, clientFilters: [] };
}
