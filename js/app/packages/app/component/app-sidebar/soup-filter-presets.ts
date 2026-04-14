import type { FilterID, FilterAst } from '@app/component/next-soup/filters';
import { ast } from '@app/component/next-soup/filters';
import type { ListView } from '@app/constants/list-views';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';

export type SoupFiltersPreset = {
  /** AST filters for server query */
  ast: FilterAst;
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

const NIL = '00000000-0000-0000-0000-000000000000';

/** AST for inbox/signal: not done, importance=true for emails */
const INBOX_SIGNAL_AST: FilterAst = {
  df: ast.eq('nd', false),
  ef: ast.and(ast.eq('NotificationDone', false), ast.eq('Importance', true)),
  chanf: ast.eq('NotificationDone', false),
  cf: ast.eq('NotificationDone', false),
  pf: ast.eq('NotificationDone', false),
  emailView: 'inbox',
};

/** AST for inbox/noise: not done, importance=false for emails */
const INBOX_NOISE_AST: FilterAst = {
  df: ast.eq('nd', false),
  ef: ast.and(ast.eq('NotificationDone', false), ast.eq('Importance', false)),
  chanf: ast.eq('NotificationDone', false),
  cf: ast.eq('NotificationDone', false),
  pf: ast.eq('NotificationDone', false),
  emailView: 'inbox',
};

export const VIEW_TAB_PRESETS: Record<ListView, ViewTabConfig> = {
  inbox: {
    default: 'signal',
    tabs: {
      signal: () => ({
        ast: INBOX_SIGNAL_AST,
        clientFilters: ['inbox'],
      }),
      noise: () => ({
        ast: INBOX_NOISE_AST,
        clientFilters: ['noise'],
      }),
      all: () => ({
        ast: {
          df: ast.neq('id', NIL),
          ef: ast.neq('ThreadId', NIL),
          chanf: ast.neq('ChannelId', NIL),
          cf: ast.neq('ChatId', NIL),
          pf: ast.neq('ProjectId', NIL),
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
          ast: { cf: ast.eq('Owner', ctx.userId) },
          clientFilters: ['agent'],
        };
      },
      running: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          ast: { cf: ast.eq('Owner', ctx.userId) },
          clientFilters: ['agent', 'owned-entity'],
        };
      },
      shared: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          ast: { cf: ast.neq('Owner', ctx.userId) },
          clientFilters: ['agent', 'shared-entity'],
        };
      },
    },
  },
  mail: {
    default: 'important',
    tabs: {
      important: () => ({
        ast: { ef: ast.eq('Importance', true), emailView: 'inbox' },
        clientFilters: ['email', 'no-drafts'],
      }),
      noise: () => ({
        ast: { ef: ast.eq('Importance', false), emailView: 'inbox' },
        clientFilters: ['email', 'no-drafts'],
      }),
      drafts: () => ({
        ast: { ef: ast.neq('ThreadId', NIL), emailView: 'drafts' },
        clientFilters: ['email-drafts'],
      }),
      sent: (ctx) => {
        if (!ctx.email) return undefined;
        return {
          ast: { ef: ast.eq('Sender', ctx.email), emailView: 'sent' },
          clientFilters: ['email', 'no-drafts'],
        };
      },
      shared: () => ({
        ast: { ef: ast.eq('Shared', true), emailView: 'all' },
        clientFilters: ['email', 'shared-entity'],
      }),
      all: () => ({
        ast: { ef: ast.neq('ThreadId', NIL), emailView: 'all' },
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
          ast: {
            df: ast.and(ast.neq('dst', 'task'), ast.eq('o', ctx.userId)),
          },
          clientFilters: [
            'document-or-file',
            'owned-entity',
          ],
        };
      },
      shared: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          ast: {
            df: ast.and(ast.neq('dst', 'task'), ast.neq('o', ctx.userId)),
          },
          clientFilters: [
            'document-or-file',
            'shared-entity',
          ],
        };
      },
      attachments: () => ({
        ast: { df: ast.eq('iea', true) },
        clientFilters: ['document-or-file'],
      }),
      all: () => ({
        ast: { df: ast.neq('dst', 'task') },
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
          ast: {
            df: ast.eq('dst', 'task'),
            propf: ast.and(
              ast.propEntity(SYSTEM_PROPERTY_IDS.ASSIGNEES, ctx.userId),
              ast.and(
                ast.not(
                  ast.propSelect(
                    SYSTEM_PROPERTY_IDS.STATUS,
                    PROPERTY_OPTION_IDS.STATUS.COMPLETED
                  )
                ),
                ast.not(
                  ast.propSelect(
                    SYSTEM_PROPERTY_IDS.STATUS,
                    PROPERTY_OPTION_IDS.STATUS.CANCELED
                  )
                )
              )
            ),
          },
          clientFilters: ['task', 'assigned-to', 'active-task'],
        };
      },
      'created-by-me': (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          ast: {
            df: ast.and(ast.eq('dst', 'task'), ast.eq('o', ctx.userId)),
          },
          clientFilters: [
            'task',
            'active-task',
            'owned-entity',
          ],
        };
      },
      all: () => ({
        ast: { df: ast.eq('dst', 'task') },
        clientFilters: ['task'],
      }),
    },
  },
  channels: {
    default: 'recent',
    tabs: {
      recent: () => ({
        ast: { chanf: ast.eq('Importance', true) },
        clientFilters: ['channels'],
      }),
      people: () => ({
        ast: { chanf: ast.eq('ChannelType', 'direct_message') },
        clientFilters: ['people'],
      }),
      teams: () => ({
        ast: { chanf: ast.neq('ChannelType', 'direct_message') },
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
          ast: { pf: ast.eq('Owner', ctx.userId) },
          clientFilters: ['folders', 'owned-entity'],
        };
      },
      all: () => ({
        ast: { pf: ast.neq('ProjectId', NIL) },
        clientFilters: ['folders'],
      }),
    },
  },
  search: {
    default: 'all',
    tabs: {
      all: () => ({
        ast: {},
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
  return { ast: {}, clientFilters: [] };
}
