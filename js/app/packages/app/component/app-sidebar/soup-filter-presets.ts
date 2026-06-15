import type { FilterID } from '@app/component/next-soup/filters';
import {
  defineQueryFilters,
  NIL_UUID,
  type Query,
} from '@app/component/next-soup/filters/filter-store';
import type { ListView } from '@app/constants/list-views';
import {
  ENABLE_SNIPPETS,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
} from '@core/constant/featureFlags';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { startOfDay, subWeeks } from 'date-fns';

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
  /** True iff the current user has admin/owner team role. Drives
   * visibility of admin-only tabs (e.g. companies → hidden). */
  isTeamAdmin: boolean;
};

type TabPresetResolver = (ctx: PresetContext) => SoupFiltersPreset | undefined;

type TabConfig = Record<string, TabPresetResolver>;

type ViewTabConfig = {
  default: string;
  tabs: TabConfig;
};

const getExcludedDocumentSubTypes = (...subTypes: string[]) =>
  ENABLE_SNIPPETS() ? subTypes : [...subTypes, 'snippet'];

const getDisabledSnippetSubtypeExclude = (): Query['exclude'] =>
  ENABLE_SNIPPETS() ? {} : { subType: ['snippet'] };

/** Filters for inbox/signal: not done, importance=true for emails, 2-week window */
const getInboxSignalFilters = () => {
  const twoWeeksAgo = subWeeks(startOfDay(new Date()), 2).toISOString();
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
      // Foreign entities (e.g. GitHub PRs) with a not-done notification.
      // Referencing `fef` also opts them into the signal query (otherwise
      // defineQueryFilters excludes unreferenced entity types). Rendering is
      // still gated on the supported-foreign-entities flag client-side.
      foreignEntityDone: false,
      emailShared: 'exclude',
    },
    exclude: getDisabledSnippetSubtypeExclude(),
    emailView: 'inbox',
  });
};

/** Filters for inbox/noise: not done, importance=false for emails */
const getInboxNoiseFilters = () =>
  defineQueryFilters({
    include: {
      documentDone: false,
      emailDone: false,
      emailImportance: false,
      channelDone: false,
      chatDone: false,
      folderDone: false,
      emailShared: 'exclude',
    },
    exclude: getDisabledSnippetSubtypeExclude(),
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
        filters: getInboxNoiseFilters(),
        clientFilters: { and: ['noise'] },
      }),
      all: () => ({
        filters: {
          // crm companies aren't surfaced outside the Companies view.
          include: { crmCompanyId: [NIL_UUID] },
          exclude: {
            documentId: [NIL_UUID],
            threadId: [NIL_UUID],
            channelId: [NIL_UUID],
            chatId: [NIL_UUID],
            folderId: [NIL_UUID],
            foreignEntityRecordId:
              ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE ? [NIL_UUID] : [],
            ...getDisabledSnippetSubtypeExclude(),
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
            include: {
              documentOwnerId: [ctx.userId],
              isEmailAttachment: false,
            },
            exclude: { subType: getExcludedDocumentSubTypes('task') },
          }),
          clientFilters: { and: ['document-or-file', 'owned-entity'] },
        };
      },
      shared: (ctx) => {
        if (!ctx.userId) return undefined;
        return {
          filters: defineQueryFilters({
            include: {
              isEmailAttachment: false,
            },
            exclude: {
              subType: getExcludedDocumentSubTypes('task'),
              documentOwnerId: [ctx.userId],
            },
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
      folders: () => ({
        filters: defineQueryFilters({
          exclude: { folderId: [NIL_UUID] },
        }),
        clientFilters: { and: ['folders'] },
      }),
      all: () => ({
        filters: defineQueryFilters({
          exclude: { subType: getExcludedDocumentSubTypes('task') },
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
      missed: () => ({
        filters: defineQueryFilters(
          {
            include: { callStatus: 'MISSED' },
          },
          { skipTargets: ['callf'] }
        ),
        clientFilters: { and: ['calls'] },
      }),
      unattended: () => ({
        filters: defineQueryFilters(
          {
            include: { callStatus: 'UNATTENDED' },
          },
          { skipTargets: ['callf'] }
        ),
        clientFilters: { and: ['calls'] },
      }),
    },
  },
  companies: {
    default: 'active',
    tabs: {
      active: () => ({
        filters: defineQueryFilters(
          { include: { crmCompanyHidden: false } },
          { skipTargets: ['ccf'] }
        ),
        clientFilters: { and: ['crm-company-active'] },
      }),
      // Admin/owner only — the BE rejects `hidden: true` requests from
      // non-admins with 403. Returning `undefined` hides the tab for
      // non-admins via the same pattern context-required views use.
      hidden: (ctx) => {
        if (!ctx.isTeamAdmin) return undefined;
        return {
          filters: defineQueryFilters(
            { include: { crmCompanyHidden: true } },
            { skipTargets: ['ccf'] }
          ),
          clientFilters: { and: ['crm-company-hidden'] },
        };
      },
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
        // Temporary: search has no full-text index over foreign entities yet,
        // so always exclude them (matching no record id) until search supports
        // them. CRM rows are NIL-excluded the same way. `search-supported`
        // mirrors these exclusions client-side so entities that enter the
        // soup cache outside this query (e.g. websocket-driven inserts)
        // don't surface in the search feed.
        filters: {
          include: {
            foreignEntityRecordId: [NIL_UUID],
            crmCompanyId: [NIL_UUID],
          },
          exclude: getDisabledSnippetSubtypeExclude(),
        },
        clientFilters: { and: ['search-supported'] },
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
    isTeamAdmin: false,
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
