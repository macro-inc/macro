import type { ListView } from '@app/constants/list-views';
import type { FilterID } from '@app/features/next-soup/filters';
import { getMyTasksQuery } from '@app/features/next-soup/filters/configs/my-tasks';
import {
  defineQueryFilters,
  NIL_UUID,
  type Query,
} from '@app/features/next-soup/filters/filter-store';
import {
  ENABLE_CALENDAR_SEARCH_UI,
  ENABLE_CALENDAR_UI,
  ENABLE_REMINDERS,
  ENABLE_SNIPPETS,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
} from '@core/constant/featureFlags';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Params } from '@service-storage/generated/schemas/params';
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
  /**
   * Direction to order the server page in. Defaults to `desc` when absent,
   * matching every feed that reads newest-first.
   */
  sortDirection?: 'asc' | 'desc';
  /**
   * Server sort this tab's meaning requires (e.g. `touched_by_me`), taking
   * precedence over the client sort state. Tabs that force one usually also
   * clear the client sort (`SoupView`'s `initialClientSort={[]}`) so the
   * server's ordering survives to the rendered rows. Frecency is excluded:
   * it is a different query flavor with its own client handling, not a
   * per-tab ordering.
   */
  sortMethod?: Exclude<NonNullable<Params['sort_method']>, 'frecency'>;
};

// Tab preset configuration types
export type PresetContext = {
  userId: string | undefined;
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

// Default statuses for the open-task tabs; keep the ids and include props in sync.
const OPEN_TASK_STATUS_FILTER_IDS: FilterID[] = [
  'task-not-started',
  'task-in-progress',
  'task-in-review',
];

const OPEN_TASK_STATUS_INCLUDE_PROPS = [
  {
    propertyId: SYSTEM_PROPERTY_IDS.STATUS,
    type: 'select' as const,
    value: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
  },
  {
    propertyId: SYSTEM_PROPERTY_IDS.STATUS,
    type: 'select' as const,
    value: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
  },
  {
    propertyId: SYSTEM_PROPERTY_IDS.STATUS,
    type: 'select' as const,
    value: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
  },
];

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
      channelThreadDone: false,
      chatDone: false,
      chatUpdatedAt: { gte: twoWeeksAgo },
      folderDone: false,
      folderUpdatedAt: { gte: twoWeeksAgo },
      // Foreign entities (e.g. GitHub PRs) with a not-done notification.
      // Referencing `fef` also opts them into the signal query (otherwise
      // defineQueryFilters excludes unreferenced entity types). Rendering is
      // still gated on the supported-foreign-entities flag client-side.
      foreignEntitySource: ['github_pull_request'],
      foreignEntityDone: false,
      foreignEntityIncludesMe: true,
      emailShared: 'exclude',
      // Reminders are off by default server-side rather than excluded by
      // `defineQueryFilters` (there is no `remf` entry in ID_FIELD_NAMES), so
      // this literal is the only thing that surfaces them; the inbox Reminders
      // tab below sends it too, for the not-yet-fired slice. Behind the flag
      // so an unflagged user never pays for the reminders lookup on every
      // Signal fetch.
      ...(ENABLE_REMINDERS() ? { includeReminders: true } : {}),
      // Calendar events with a not-done notification (a fired event alarm).
      // Referencing `calf` opts the calendar arm into the signal query, which
      // `defineQueryFilters` otherwise excludes with a nil id filter.
      ...(ENABLE_CALENDAR_UI() ? { calendarEventDone: false } : {}),
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
      channelThreadDone: false,
      chatDone: false,
      folderDone: false,
      emailShared: 'exclude',
    },
    exclude: getDisabledSnippetSubtypeExclude(),
    emailView: 'inbox',
  });

/**
 * Filters for the Recent view: the touched-by-me feed over everything the
 * all view shows. Documents, chats, folders, channels, and emails stay
 * unrestricted via `skipTargets` — the touched candidate query includes
 * every touchable type by default, and it rejects channel/email filter
 * trees outright (400), so even the usual NIL-id opt-in trees must not be
 * sent for those two. Calendar/CRM/foreign/channel-thread targets keep
 * their NIL exclusions; the touched query has no candidates of those types
 * and ignores their trees.
 */
const getRecentFilters = () =>
  defineQueryFilters(
    { exclude: getDisabledSnippetSubtypeExclude() },
    { skipTargets: ['df', 'cf', 'pf', 'chanf', 'ef'] }
  );

export const VIEW_TAB_PRESETS: Record<ListView, ViewTabConfig> = {
  recent: {
    default: 'all',
    tabs: {
      // One tab: everything the user has touched, newest own-touch first.
      // The server ordering is the product; the client sort is cleared by
      // the view registration so rows render in server order.
      all: () => ({
        filters: getRecentFilters(),
        clientFilters: { and: ['explicit-noise'] },
        sortMethod: 'touched_by_me',
      }),
    },
  },
  inbox: {
    default: 'signal',
    tabs: {
      signal: () => ({
        filters: getInboxSignalFilters(),
        clientFilters: { and: ['inbox'] },
        groupBy: 'date',
      }),
      noise: () => ({
        filters: getInboxNoiseFilters(),
        clientFilters: { and: ['noise'] },
        groupBy: 'date',
      }),
      all: () => ({
        filters: {
          // Calendar events are not rendered by Soup, and CRM companies are
          // not surfaced outside the Companies view.
          include: {
            calendarEventId: [NIL_UUID],
            crmCompanyId: [NIL_UUID],
            ...(ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE
              ? { foreignEntitySource: ['github_pull_request'] }
              : {}),
            foreignEntityIncludesMe: true,
          },
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
        groupBy: 'date',
      }),
      // Pending reminders only: scheduled but not yet fired. A fired reminder
      // has already hit the inbox — Signal surfaces it through its not-done
      // notification — so this tab is the forward-looking complement: what is
      // coming, not what is due. Soonest first, since "newest first" on future
      // dates would put December above tomorrow.
      reminders: () => ({
        filters: defineQueryFilters({
          include: {
            includeReminders: true,
            reminderCompleted: false,
            reminderFired: false,
          },
        }),
        clientFilters: { and: ['reminders-scheduled'] },
        sortDirection: 'asc',
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
      skills: () => ({
        filters: defineQueryFilters({
          include: { subType: ['skill'] },
        }),
        clientFilters: { and: ['doc-skill'] },
      }),
    },
  },
  mail: {
    default: 'important',
    tabs: {
      // No 'no-drafts' on any thread-listing tab: a thread whose latest
      // message is a saved draft must stay in Signal/Noise/Calendar/Sent (it
      // also shows under Drafts). The server counts drafts toward is_signal
      // and inbox visibility for the same reason.
      important: () => ({
        filters: defineQueryFilters({
          include: {
            emailImportance: true,

            emailShared: 'exclude',
          },
          emailView: 'inbox',
        }),
        clientFilters: { and: ['email'] },
        groupBy: 'date',
      }),
      noise: () => ({
        filters: defineQueryFilters({
          include: {
            emailImportance: false,

            emailShared: 'exclude',
          },
          emailView: 'inbox',
        }),
        clientFilters: { and: ['email'] },
        groupBy: 'date',
      }),
      calendar: () => ({
        filters: defineQueryFilters({
          include: {
            emailShared: 'exclude',
            emailCalendarOnly: true,
          },
          emailView: 'all',
        }),

        clientFilters: { and: ['email'] },
        groupBy: 'date',
      }),
      drafts: () => ({
        filters: defineQueryFilters({
          exclude: { threadId: [NIL_UUID] },
          emailView: 'drafts',
        }),
        clientFilters: { and: ['email-drafts'] },
        groupBy: 'date',
      }),
      // No sender filter: the 'sent' view already scopes to messages with
      // is_sent = TRUE per linked inbox, which covers multi-inbox correctly
      // (a single sender address would drop secondary inboxes' sent mail).
      sent: () => ({
        filters: defineQueryFilters({
          emailView: 'sent',
        }),
        clientFilters: { and: ['email'] },
        groupBy: 'date',
      }),
      shared: () => ({
        filters: defineQueryFilters({
          include: { emailShared: 'only' },
          emailView: 'all',
        }),
        clientFilters: { and: ['email', 'shared-entity'] },
        groupBy: 'date',
      }),
      all: () => ({
        filters: defineQueryFilters({
          exclude: { threadId: [NIL_UUID] },
          emailView: 'all',
        }),
        clientFilters: { and: ['email'] },
        groupBy: 'date',
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
    default: 'my-tasks',
    tabs: {
      'my-tasks': (ctx) => {
        if (!ctx.userId) return undefined;
        const myTasksQuery = getMyTasksQuery(ctx.userId);
        return {
          filters: defineQueryFilters({
            ...myTasksQuery,
            include: {
              ...myTasksQuery.include,
              properties: [...OPEN_TASK_STATUS_INCLUDE_PROPS],
            },
          }),
          clientFilters: {
            and: ['task', 'my-tasks'],
            or: [...OPEN_TASK_STATUS_FILTER_IDS],
          },
          groupBy: `property:${SYSTEM_PROPERTY_IDS.PRIORITY}`,
        };
      },
      all: () => ({
        filters: defineQueryFilters({
          include: { subType: ['task'] },
        }),
        clientFilters: { and: ['task'] },
      }),
    },
  },
  channels: {
    default: 'recent',
    tabs: {
      recent: () => ({
        filters: defineQueryFilters({
          // Recent only shows channels the user is a participant of.
          include: {
            channelImportance: true,
            channelIsParticipant: [true],
          },
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
          // Both membership states: team channels of the user's teams they
          // haven't joined are listed too, with a Join affordance on the row.
          include: { channelIsParticipant: [true, false] },
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
        groupBy: `property:${SYSTEM_PROPERTY_IDS.STAGE}`,
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
          groupBy: `property:${SYSTEM_PROPERTY_IDS.STAGE}`,
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
  // Reminders are the one entity type that is opt-in server-side, so naming
  // `includeReminders` both surfaces them and — via defineQueryFilters, which
  // NIL-excludes every target this query does not reference — makes the view
  // reminders-only. Soup already orders them by when they fire.
  reminders: {
    default: 'active',
    tabs: {
      // Fired and waiting on you — an inbox, so newest arrival on top like
      // every other feed. `reminderFired` is a server filter rather than a
      // client one for a reason: both this tab and Scheduled would otherwise
      // share one `comp:false` query, and the page limit would be spent on
      // whichever end the sort direction favours, so a user with a hundred
      // future reminders could open Active on an empty list.
      active: () => ({
        filters: defineQueryFilters({
          include: {
            includeReminders: true,
            reminderCompleted: false,
            reminderFired: true,
          },
        }),
        clientFilters: { and: ['reminders-fired'] },
      }),
      // Not due yet. Soonest first: "newest first" on a future date means
      // furthest away first, which puts December above tomorrow.
      scheduled: () => ({
        filters: defineQueryFilters({
          include: {
            includeReminders: true,
            reminderCompleted: false,
            reminderFired: false,
          },
        }),
        clientFilters: { and: ['reminders-scheduled'] },
        sortDirection: 'asc',
      }),
      // Dealt with. Most-recently-due first, like every other archive view.
      done: () => ({
        filters: defineQueryFilters({
          include: { includeReminders: true, reminderCompleted: true },
        }),
        clientFilters: { and: ['reminders-done'] },
      }),
    },
  },
  search: {
    default: 'all',
    tabs: {
      all: () => ({
        // Temporary: search has no full-text index over foreign entities yet,
        // so always exclude them (matching no record id) until search supports
        // them. CRM and non-displayable channel-thread rows are NIL-excluded
        // the same way. Calendar events are not excluded — they carry a title
        // index of their own. `search-supported` mirrors these exclusions
        // client-side so entities that enter the soup cache outside this query
        // (e.g. websocket-driven inserts) don't surface in the search feed.
        filters: {
          include: {
            foreignEntityRecordId: [NIL_UUID],
            crmCompanyId: [NIL_UUID],
            channelThreadId: [NIL_UUID],
            // Events are title-indexed, so search returns them — but opening
            // one needs the calendar block, which the flag gates. Without it
            // a hit would render an inert row, so exclude the type instead.
            ...(ENABLE_CALENDAR_SEARCH_UI()
              ? {}
              : { calendarEventId: [NIL_UUID] }),
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
