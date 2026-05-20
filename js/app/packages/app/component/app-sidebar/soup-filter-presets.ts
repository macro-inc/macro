import type { FilterID } from '@app/component/next-soup/filters';
import {
  defineQueryFilters,
  NIL_UUID,
  type Query,
} from '@app/component/next-soup/filters/filter-store';
import type { ListView } from '@app/constants/list-views';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import { subWeeks } from 'date-fns';

type SoupFiltersPreset = {
  /** Filter data for server query */
  filters: Query;
  /** Client filters to apply */
  clientFilters: { and?: FilterID[]; or?: FilterID[] };
  /**
   * Initial group-by to apply when this tab is selected. Uses the same id
   * format consumed by `soup.grouping.setActiveGroupId` (e.g. `date`,
   * `entity_type`, `project`, or `property:<definition-id>`).
   */
  groupBy?: string;
};

// Tab preset configuration types
export type PresetContext = {
  userId: string | undefined;
  email: string | undefined;
};

type TabPresetResolver = (ctx: PresetContext) => SoupFiltersPreset | undefined;

type TabConfig = Record<string, TabPresetResolver>;

type ViewTabConfig = {
  default: string;
  tabs: TabConfig;
};

/** Filters for inbox/signal: not done, importance=true for emails, 2-week window */
const getInboxSignalFilters = () => {
  const twoWeeksAgo = subWeeks(new Date(), 2).toISOString();
  return defineQueryFilters({
    include: {
      documentDone: false,
      documentUpdatedAt: { gte: twoWeeksAgo },
      emailDone: false,
      emailImportance: true,
      emailUpdatedAt: { gte: twoWeeksAgo },
      channelDone: false,
      chatDone: false,
      chatUpdatedAt: { gte: twoWeeksAgo },
      folderDone: false,
      folderUpdatedAt: { gte: twoWeeksAgo },
      emailShared: 'exclude',
    },
    emailView: 'inbox',
  });
};

/** Filters for inbox/noise: not done, importance=false for emails */
const INBOX_NOISE_FILTERS = defineQueryFilters({
  include: {
    documentDone: false,
    emailDone: false,
    emailImportance: false,
    channelDone: false,
    chatDone: false,
    folderDone: false,
    emailShared: 'exclude',
  },
  emailView: 'inbox',
});

export const VIEW_TAB_PRESETS: Record<ListView, ViewTabConfig> = {
  inbox: {
    default: 'signal',
    tabs: {
      signal: () => ({
        filters: getInboxSignalFilters(),
        clientFilters: { and: ['inbox'] },
      }),
      noise: () => ({
        filters: INBOX_NOISE_FILTERS,
        clientFilters: { and: ['noise'] },
      }),
      all: () => ({
        filters: {
          exclude: {
            documentId: [NIL_UUID],
            threadId: [NIL_UUID],
            channelId: [NIL_UUID],
            chatId: [NIL_UUID],
            folderId: [NIL_UUID],
          },
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
          filters: defineQueryFilters({
            include: { chatOwnerId: [ctx.userId] },
          }),
          clientFilters: { and: ['agent'] },
        };
      },
      running: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: defineQueryFilters({
            include: { chatOwnerId: [ctx.userId] },
          }),
          clientFilters: { and: ['agent', 'owned-entity'] },
        };
      },
      shared: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: defineQueryFilters({
            exclude: { chatOwnerId: [ctx.userId] },
          }),
          clientFilters: { and: ['agent', 'shared-entity'] },
        };
      },
      automations: () => ({
        // Server returns nothing useful here — automations are merged
        // into the soup client-side via `additionalEntities`.
        filters: defineQueryFilters({}),
        clientFilters: { and: ['automation'] },
      }),
    },
  },
  mail: {
    default: 'important',
    tabs: {
      important: () => ({
        filters: defineQueryFilters({
          include: {
            emailImportance: true,

            emailShared: 'exclude',
          },
          emailView: 'inbox',
        }),
        clientFilters: { and: ['email', 'no-drafts'] },
      }),
      noise: () => ({
        filters: defineQueryFilters({
          include: {
            emailImportance: false,

            emailShared: 'exclude',
          },
          emailView: 'inbox',
        }),
        clientFilters: { and: ['email', 'no-drafts'] },
      }),
      calendar: () => ({
        filters: defineQueryFilters({
          include: {
            emailShared: 'exclude',
            emailCalendarOnly: true,
          },
          emailView: 'all',
        }),

        clientFilters: { and: ['email', 'no-drafts'] },
      }),
      drafts: () => ({
        filters: defineQueryFilters({
          exclude: { threadId: [NIL_UUID] },
          emailView: 'drafts',
        }),
        clientFilters: { and: ['email-drafts'] },
      }),
      sent: (ctx) => {
        if (!ctx.email) return undefined;
        return {
          filters: defineQueryFilters({
            include: { emailSender: [ctx.email] },
            emailView: 'sent',
          }),
          clientFilters: { and: ['email', 'no-drafts'] },
        };
      },
      shared: () => ({
        filters: defineQueryFilters({
          include: { emailShared: 'only' },
          emailView: 'all',
        }),
        clientFilters: { and: ['email', 'shared-entity'] },
      }),
      all: () => ({
        filters: defineQueryFilters({
          exclude: { threadId: [NIL_UUID] },
          emailView: 'all',
        }),
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
          filters: defineQueryFilters({
            include: { documentOwnerId: [ctx.userId] },
            exclude: { subType: ['task'] },
          }),
          clientFilters: { and: ['document-or-file', 'owned-entity'] },
        };
      },
      shared: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: defineQueryFilters({
            exclude: { subType: ['task'], documentOwnerId: [ctx.userId] },
          }),
          clientFilters: { and: ['document-or-file', 'shared-entity'] },
        };
      },
      attachments: () => ({
        filters: defineQueryFilters({
          include: { isEmailAttachment: true },
        }),
        clientFilters: { and: ['document-or-file'] },
      }),
      all: () => ({
        filters: defineQueryFilters({
          exclude: { subType: ['task'] },
        }),
        clientFilters: { and: ['document-or-file'] },
      }),
    },
  },
  tasks: {
    default: 'assigned-to-me',
    tabs: {
      'assigned-to-me': (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: defineQueryFilters({
            include: {
              subType: ['task'],
              properties: [
                {
                  propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
                  type: 'entity',
                  value: ctx.userId,
                },
              ],
            },
            exclude: {
              properties: [
                {
                  propertyId: SYSTEM_PROPERTY_IDS.STATUS,
                  type: 'select',
                  value: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
                },
                {
                  propertyId: SYSTEM_PROPERTY_IDS.STATUS,
                  type: 'select',
                  value: PROPERTY_OPTION_IDS.STATUS.CANCELED,
                },
              ],
            },
          }),
          clientFilters: { and: ['task', 'assigned-to', 'active-task'] },
          groupBy: `property:${SYSTEM_PROPERTY_IDS.PRIORITY}`,
        };
      },
      'created-by-me': (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: defineQueryFilters({
            include: { subType: ['task'], documentOwnerId: [ctx.userId] },
          }),
          clientFilters: { and: ['task', 'active-task', 'owned-entity'] },
          groupBy: `property:${SYSTEM_PROPERTY_IDS.STATUS}`,
        };
      },
      all: () => ({
        filters: defineQueryFilters({
          include: { subType: ['task'] },
        }),
        clientFilters: { and: ['task'] },
        groupBy: `property:${SYSTEM_PROPERTY_IDS.ASSIGNEES}`,
      }),
    },
  },
  channels: {
    default: 'recent',
    tabs: {
      recent: () => ({
        filters: defineQueryFilters({
          include: { channelImportance: true },
        }),
        clientFilters: { and: ['channels'] },
      }),
      people: () => ({
        filters: defineQueryFilters({
          include: { channelType: ['direct_message'] },
        }),
        clientFilters: { and: ['people'] },
      }),
      teams: () => ({
        filters: defineQueryFilters({
          exclude: { channelType: ['direct_message'] },
        }),
        clientFilters: { and: ['teams'] },
      }),
    },
  },
  calls: {
    default: 'all',
    tabs: {
      all: () => ({
        filters: defineQueryFilters({}, { skipTargets: ['callf'] }),
        clientFilters: { and: ['calls'] },
      }),
      unattended: () => ({
        filters: defineQueryFilters(
          {
            include: { callAttended: false },
          },
          { skipTargets: ['callf'] }
        ),
        clientFilters: { and: ['calls'] },
      }),
    },
  },
  folders: {
    default: 'owned',
    tabs: {
      owned: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: defineQueryFilters({
            include: { folderOwnerId: [ctx.userId] },
          }),
          clientFilters: { and: ['folders', 'owned-entity'] },
        };
      },
      all: () => ({
        filters: defineQueryFilters({
          exclude: { folderId: [NIL_UUID] },
        }),
        clientFilters: { and: ['folders'] },
      }),
    },
  },
  search: {
    default: 'all',
    tabs: {
      all: () => ({
        filters: {},
        clientFilters: {},
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
