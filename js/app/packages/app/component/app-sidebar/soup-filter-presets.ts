import type { FilterID } from '@app/component/next-soup/filters';
import {
  NIL,
  type FilterData,
  type EmailView,
} from '@app/component/next-soup/filters/filter-store';
import type { ListView } from '@app/constants/list-views';
import { PROPERTY_OPTION_IDS } from '@core/component/Properties/constants';

export type SoupFiltersPreset = {
  /** Filter data for server query */
  filters: Partial<FilterData>;
  /** Client filters to apply */
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

/** Filters for inbox/signal: not done, importance=true for emails */
const INBOX_SIGNAL_FILTERS: Partial<FilterData> = {
  include: {
    documentDone: [false],
    emailDone: [false],
    emailImportance: [true],
    channelDone: [false],
    chatDone: [false],
    folderDone: [false],
  },
  emailView: 'inbox',
};

/** Filters for inbox/noise: not done, importance=false for emails */
const INBOX_NOISE_FILTERS: Partial<FilterData> = {
  include: {
    documentDone: [false],
    emailDone: [false],
    emailImportance: [false],
    channelDone: [false],
    chatDone: [false],
    folderDone: [false],
  },
  emailView: 'inbox',
};

export const VIEW_TAB_PRESETS: Record<ListView, ViewTabConfig> = {
  inbox: {
    default: 'signal',
    tabs: {
      signal: () => ({
        filters: INBOX_SIGNAL_FILTERS,
        clientFilters: ['inbox'],
      }),
      noise: () => ({
        filters: INBOX_NOISE_FILTERS,
        clientFilters: ['noise'],
      }),
      all: () => ({
        filters: {
          exclude: {
            documentId: [NIL],
            threadId: [NIL],
            channelId: [NIL],
            chatId: [NIL],
            folderId: [NIL],
          },
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
          filters: {
            include: { chatOwnerId: [ctx.userId] },
          },
          clientFilters: ['agent'],
        };
      },
      running: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: {
            include: { chatOwnerId: [ctx.userId] },
          },
          clientFilters: ['agent', 'owned-entity'],
        };
      },
      shared: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: {
            exclude: { chatOwnerId: [ctx.userId] },
          },
          clientFilters: ['agent', 'shared-entity'],
        };
      },
    },
  },
  mail: {
    default: 'important',
    tabs: {
      important: () => ({
        filters: {
          include: { emailImportance: [true] },
          emailView: 'inbox',
        },
        clientFilters: ['email', 'no-drafts'],
      }),
      noise: () => ({
        filters: {
          include: { emailImportance: [false] },
          emailView: 'inbox',
        },
        clientFilters: ['email', 'no-drafts'],
      }),
      drafts: () => ({
        filters: {
          exclude: { threadId: [NIL] },
          emailView: 'drafts',
        },
        clientFilters: ['email-drafts'],
      }),
      sent: (ctx) => {
        if (!ctx.email) return undefined;
        return {
          filters: {
            include: { sender: [ctx.email] },
            emailView: 'sent',
          },
          clientFilters: ['email', 'no-drafts'],
        };
      },
      shared: () => ({
        filters: {
          include: { shared: ['only'] },
          emailView: 'all',
        },
        clientFilters: ['email', 'shared-entity'],
      }),
      all: () => ({
        filters: {
          exclude: { threadId: [NIL] },
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
          filters: {
            include: { documentOwnerId: [ctx.userId] },
            exclude: { subType: ['task'] },
          },
          clientFilters: ['document-or-file', 'owned-entity'],
        };
      },
      shared: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: {
            exclude: { subType: ['task'], documentOwnerId: [ctx.userId] },
          },
          clientFilters: ['document-or-file', 'shared-entity'],
        };
      },
      attachments: () => ({
        filters: {
          include: { isEmailAttachment: [true] },
        },
        clientFilters: ['document-or-file'],
      }),
      all: () => ({
        filters: {
          exclude: { subType: ['task'] },
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
          filters: {
            include: { subType: ['task'] },
            properties: [
              { ASSIGNEES: [{ type: 'entity', value: ctx.userId }] },
              {
                STATUS: [
                  {
                    type: 'select',
                    value: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
                    negate: true,
                  },
                ],
              },
              {
                STATUS: [
                  {
                    type: 'select',
                    value: PROPERTY_OPTION_IDS.STATUS.CANCELED,
                    negate: true,
                  },
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
          filters: {
            include: { subType: ['task'], documentOwnerId: [ctx.userId] },
          },
          clientFilters: ['task', 'active-task', 'owned-entity'],
        };
      },
      all: () => ({
        filters: {
          include: { subType: ['task'] },
        },
        clientFilters: ['task'],
      }),
    },
  },
  channels: {
    default: 'recent',
    tabs: {
      recent: () => ({
        filters: {
          include: { channelImportance: [true] },
        },
        clientFilters: ['channels'],
      }),
      people: () => ({
        filters: {
          include: { channelType: ['direct_message'] },
        },
        clientFilters: ['people'],
      }),
      teams: () => ({
        filters: {
          exclude: { channelType: ['direct_message'] },
        },
        clientFilters: ['teams'],
      }),
    },
  },
  calls: {
    default: 'all',
    tabs: {
      all: () => ({
        filters: {
          exclude: { callChannelId: [NIL] },
        },
        clientFilters: ['calls'],
      }),
    },
  },
  folders: {
    default: 'owned',
    tabs: {
      owned: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: {
            include: { folderOwnerId: [ctx.userId] },
          },
          clientFilters: ['folders', 'owned-entity'],
        };
      },
      all: () => ({
        filters: {
          exclude: { folderId: [NIL] },
        },
        clientFilters: ['folders'],
      }),
    },
  },
  search: {
    default: 'all',
    tabs: {
      all: () => ({
        filters: {},
        clientFilters: [],
      }),
    },
  },
};

/** Views whose default tab requires user context */
type ContextRequiredView = 'agents' | 'documents' | 'tasks' | 'folders';

/** Views whose default tab works without user context */
type ContextOptionalView = Exclude<ListView, ContextRequiredView>;

/** Overload: views that don't require context */
export function getViewPreset(
  view: ContextOptionalView,
  tab?: string
): SoupFiltersPreset | undefined;

/** Overload: views that require user context */
export function getViewPreset(
  view: ContextRequiredView,
  tab: string | undefined,
  ctx: PresetContext
): SoupFiltersPreset | undefined;

/** Overload: any view with context */
export function getViewPreset(
  view: ListView,
  tab: string | undefined,
  ctx: PresetContext
): SoupFiltersPreset | undefined;

export function getViewPreset(
  view: ListView,
  tab?: string,
  ctx?: PresetContext
): SoupFiltersPreset | undefined {
  const config = VIEW_TAB_PRESETS[view];
  if (!config) return undefined;

  const tabId = tab ?? config.default;
  const resolver = config.tabs[tabId];
  if (!resolver) return undefined;

  const presetCtx: PresetContext = ctx ?? {
    userId: undefined,
    email: undefined,
  };
  const resolved = resolver(presetCtx);
  if (resolved) return resolved;

  // Fallback: find first tab that works with provided context
  for (const fallbackResolver of Object.values(config.tabs)) {
    const fallback = fallbackResolver(presetCtx);
    if (fallback) return fallback;
  }

  return undefined;
}
