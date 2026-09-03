import { analytics } from '@app/lib/analytics';

/**
 * This constant reflects whether the app is running locally with hot reload enabled
 *
 * @returns true in bun run dev, false otherwise
 *
 * Distinct from `import.meta.env.DEV` (true under vite serve *and* local-backend
 * static bundles) and `DEV_MODE_ENV` (true whenever MODE=development, including
 * dev.macro.com).
 */
export const LOCAL_ONLY = !!import.meta.hot;

const parseBooleanOverride = (value: unknown): boolean | undefined =>
  value === 'true' ? true : value === 'false' ? false : undefined;

/**
 * Reads a `VITE_<flagName>` env override. Returns `undefined` when unset, so
 * callers can fall through to PostHog rather than forcing the flag off.
 */
export function getFeatureFlagOverride(flagName: string): boolean | undefined {
  return parseBooleanOverride(import.meta.env[`VITE_${flagName}`]);
}

export function resolveFeatureFlag(
  flagName: string,
  defaultValue: boolean
): boolean {
  return getFeatureFlagOverride(flagName) ?? defaultValue;
}

/**
 * This constant reflects whether the app is running in development mode with dev backend environment
 *
 * @returns true in dev.macro.com and bun run dev, false otherwise
 */
export const DEV_MODE_ENV = import.meta.env.MODE === 'development';

type EnvFlagConfig = {
  key?: never;
  env: string;
  default?: boolean;
};

type RemoteFlagConfig = {
  key: string;
  env?: string;
  default?: boolean;
};

/** Compile-time / env-only flag. Read with `isFeatureEnabled`. */
export type EnvFlag = {
  enabled: boolean;
};

/** PostHog-backed flag. Read with `useFeatureFlag` or `isFeatureEnabled`. */
export type RemoteFlag = {
  key: string;
  override: boolean | undefined;
};

export type Flag = EnvFlag | RemoteFlag;

function envOverride(env: string | undefined): boolean | undefined {
  return env === undefined ? undefined : getFeatureFlagOverride(env);
}

/**
 * Define a feature flag. Pass `key` for PostHog, or `env` (and no `key`)
 * for env-only. `env` is the name after `VITE_`, e.g. `'ENABLE_REMINDERS'`.
 *
 * `default` is used when env is unset. Omit it on env-only flags for `false`.
 * For remote flags, omit it (or pass `undefined`) to defer to PostHog.
 * The caller decides when a default applies, e.g. `DEV_MODE_ENV || undefined`.
 *
 * Remote: `useFeatureFlag(flag)` or `isFeatureEnabled(flag)`.
 * Env-only: `isFeatureEnabled(flag)` only.
 */
export function defineFlag(config: RemoteFlagConfig): RemoteFlag;
export function defineFlag(config: EnvFlagConfig): EnvFlag;
export function defineFlag(config: RemoteFlagConfig | EnvFlagConfig): Flag {
  if (config.key !== undefined) {
    return {
      key: config.key,
      override: envOverride(config.env) ?? config.default,
    };
  }

  return {
    enabled: envOverride(config.env) ?? config.default ?? false,
  };
}

/**
 * Imperative snapshot. Env/`default` override wins. Otherwise PostHog,
 * or `false` if flags have not loaded or the key is unknown.
 */
export function isFeatureEnabled(flag: Flag): boolean {
  if ('key' in flag) {
    if (flag.override !== undefined) {
      return flag.override;
    }
    return analytics.posthog.isFeatureEnabled(flag.key) ?? false;
  }
  return flag.enabled;
}

/**
 * Switches Inbox, Tasks, and Channels from the current SoupView implementations
 * to the new composable view implementations. Override locally with
 * VITE_ENABLE_NEW_APP_VIEWS.
 */
export const enableNewAppViews = defineFlag({
  key: 'enable-new-app-views',
  env: 'ENABLE_NEW_APP_VIEWS',
});

/**
 * This constant reflects whether the app is running in production mode with prod backend environment
 *
 * @returns true in macro.com, false otherwise
 */
export const PROD_MODE_ENV = import.meta.env.MODE === 'production';

const onInDev = DEV_MODE_ENV || undefined;

export const ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE = defineFlag({
  env: 'ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE',
  default: true,
}).enabled;

export const ENABLE_PDF_LOCATION_AUTOSAVE = defineFlag({
  env: 'ENABLE_PDF_LOCATION_AUTOSAVE',
  default: true,
}).enabled;

export const ENABLE_PDF_TABS = defineFlag({
  env: 'ENABLE_PDF_TABS',
  default: true,
}).enabled;

export const ENABLE_PDF_MARKUP = defineFlag({
  env: 'ENABLE_PDF_MARKUP',
  default: true,
}).enabled;

// NOTE: disabling scripting: event listener needs to be properly unmounted first
// this is the offending line in our pdfjs repo, which has been fixed in the upstream
// https://github.com/macro-inc/pdf.js/blob/d22768d78ebaaf038707d3d926992a7aeb88e730/web/pdf_scripting_manager.js?plain=1#L59
export const ENABLE_SCRIPTING = defineFlag({
  env: 'ENABLE_SCRIPTING',
  default: false,
}).enabled;

export const ENABLE_PDF_MULTISPLIT = defineFlag({
  env: 'ENABLE_PDF_MULTISPLIT',
  default: true,
}).enabled;

export const ENABLE_PROJECT_SHARING = defineFlag({
  env: 'ENABLE_PROJECT_SHARING',
  default: true,
}).enabled;

export const ENABLE_CANVAS_IMAGES = defineFlag({
  env: 'ENABLE_CANVAS_IMAGES',
  default: true,
}).enabled;

export const ENABLE_CANVAS_FILES = defineFlag({
  env: 'ENABLE_CANVAS_FILES',
  default: true,
}).enabled;

export const ENABLE_CANVAS_TEXT = defineFlag({
  env: 'ENABLE_CANVAS_TEXT',
  default: true,
}).enabled;

export const ENABLE_LIVE_INDICATORS = defineFlag({
  env: 'ENABLE_LIVE_INDICATORS',
  default: true,
}).enabled;

export const ENABLE_PROFILE_PICTURES = defineFlag({
  env: 'ENABLE_PROFILE_PICTURES',
  default: true,
}).enabled;

export const ENABLE_VIDEO_BLOCK = defineFlag({
  env: 'ENABLE_VIDEO_BLOCK',
  default: true,
}).enabled;

export const ENABLE_DOCX_TO_PDF = defineFlag({
  env: 'ENABLE_DOCX_TO_PDF',
  default: true,
}).enabled;

export const ENABLE_MARKDOWN_LIVE_COLLABORATION = defineFlag({
  env: 'ENABLE_MARKDOWN_LIVE_COLLABORATION',
  default: true,
}).enabled;

export const ENABLE_EMAIL = defineFlag({
  env: 'ENABLE_EMAIL',
  default: true,
}).enabled;

export const ENABLE_BLOCK_IN_BLOCK = defineFlag({
  env: 'ENABLE_BLOCK_IN_BLOCK',
  default: true,
}).enabled;

export const ENABLE_SEARCH_SERVICE = defineFlag({
  env: 'ENABLE_SEARCH_SERVICE',
  default: true,
}).enabled;

export const ENABLE_MARKDOWN_DIFF = defineFlag({
  env: 'ENABLE_MARKDOWN_DIFF',
  default: true,
}).enabled;

export const ENABLE_BEARER_TOKEN_AUTH = defineFlag({
  env: 'ENABLE_BEARER_TOKEN_AUTH',
  default: false,
}).enabled;

export const ENABLE_MARKDOWN_SEARCH_TEXT = defineFlag({
  env: 'ENABLE_MARKDOWN_SEARCH_TEXT',
  default: DEV_MODE_ENV,
}).enabled;

export const CANVAS_SVG_IMPORT = defineFlag({
  env: 'CANVAS_SVG_IMPORT',
  default: true,
}).enabled;

export const ENABLE_CANVAS_VIDEO = defineFlag({
  env: 'ENABLE_CANVAS_VIDEO',
  default: true,
}).enabled;

// TODO: figure out why the image does not load into canvas after upload
export const ENABLE_CANVAS_HEIC = defineFlag({
  env: 'ENABLE_CANVAS_HEIC',
  default: false,
}).enabled;

// TODO - comments are not stable in markdown multiplayer, they will need more work.
export const ENABLE_MARKDOWN_COMMENTS = defineFlag({
  env: 'ENABLE_MARKDOWN_COMMENTS',
  default: true,
}).enabled;

export const ENABLE_REFERENCES_MODAL = defineFlag({
  env: 'ENABLE_REFERENCES_MODAL',
  default: true,
}).enabled;

export const ENABLE_MENTION_TRACKING = defineFlag({
  env: 'ENABLE_MENTION_TRACKING',
  default: true,
}).enabled;

export const ENABLE_CHAT_CHANNEL_ATTACHMENT = defineFlag({
  env: 'ENABLE_CHAT_CHANNEL_ATTACHMENT',
  default: true,
}).enabled;

export const ENABLE_SVG_PREVIEW = defineFlag({
  env: 'ENABLE_SVG_PREVIEW',
  default: true,
}).enabled;

export const USE_WIDE_ICONS = defineFlag({
  env: 'USE_WIDE_ICONS',
  default: true,
}).enabled;

export const ENABLE_ANIMATED_ICONS = defineFlag({
  env: 'ENABLE_ANIMATED_ICONS',
  default: true,
}).enabled;

export const ENABLE_TTFT = defineFlag({
  env: 'ENABLE_TTFT',
  default: DEV_MODE_ENV,
}).enabled;

export const ENABLE_INBOX_RESYNC = defineFlag({
  env: 'ENABLE_INBOX_RESYNC',
  default: false,
}).enabled;

export const ENABLE_INBOX_SYNC_STATUS = defineFlag({
  env: 'ENABLE_INBOX_SYNC_STATUS',
  default: true,
}).enabled;

export const ENABLE_EMAIL_SHARING = defineFlag({
  env: 'ENABLE_EMAIL_SHARING',
  default: true,
}).enabled;

export const ENABLE_DOCUMENT_MENTION_NOTIFICATIONS = defineFlag({
  env: 'ENABLE_DOCUMENT_MENTION_NOTIFICATIONS',
  default: DEV_MODE_ENV,
}).enabled;

export const ENABLE_STATIC_DOCUMENT_CARDS = defineFlag({
  env: 'ENABLE_STATIC_DOCUMENT_CARDS',
  default: false,
}).enabled;

export const ENABLE_MARKDOWN_AI_GENERATE = defineFlag({
  env: 'ENABLE_MARKDOWN_AI_GENERATE',
  default: false,
}).enabled;

export const ENABLE_UNIFIED_LIST_AI_INPUT = defineFlag({
  env: 'ENABLE_UNIFIED_LIST_AI_INPUT',
  default: true,
}).enabled;

export const ENABLE_EMAIL_SCHEDULED_SEND = defineFlag({
  env: 'ENABLE_EMAIL_SCHEDULED_SEND',
  default: true,
}).enabled;

export const ENABLE_FEATURED_SEARCH_RESULTS = defineFlag({
  env: 'ENABLE_FEATURED_SEARCH_RESULTS',
  default: true,
}).enabled;

export const ENABLE_PROXY_EMAIL_IMAGES = defineFlag({
  env: 'ENABLE_PROXY_EMAIL_IMAGES',
  default: true,
}).enabled;

export const ENABLE_CLIENT_EMAIL_SIGNAL_FILTER = defineFlag({
  env: 'ENABLE_CLIENT_EMAIL_SIGNAL_FILTER',
  default: false,
}).enabled;

export const ENABLE_APP_STORE_QR_CODE = defineFlag({
  env: 'ENABLE_APP_STORE_QR_CODE',
  default: true,
}).enabled;

export const ENABLE_PR_DISCUSSION_INPUT = defineFlag({
  env: 'ENABLE_PR_DISCUSSION_INPUT',
  default: false,
}).enabled;

export const USE_MACRO_PR_SUMMARY_BLOCK = defineFlag({
  env: 'USE_MACRO_PR_SUMMARY_BLOCK',
  default: true,
}).enabled;

export const ENABLE_CALLKIT = defineFlag({
  env: 'ENABLE_CALLKIT',
  default: true,
}).enabled;

export const ENABLE_MARKDOWN_SIDE_PANEL = defineFlag({
  env: 'ENABLE_MARKDOWN_SIDE_PANEL',
  default: true,
}).enabled;

export const ENABLE_REFOCUS_HIGHLIGHT = defineFlag({
  env: 'ENABLE_REFOCUS_HIGHLIGHT',
  default: true,
}).enabled;

export const ENABLE_CREATE_PROPERTY = defineFlag({
  env: 'ENABLE_CREATE_PROPERTY',
  default: true,
}).enabled;

export const UNIFIED_CHANNEL_INPUT = defineFlag({
  env: 'UNIFIED_CHANNEL_INPUT',
  default: false,
}).enabled;

export const ENABLE_GRAPHQL_BACKFILL = defineFlag({
  env: 'ENABLE_GRAPHQL_BACKFILL',
  default: true,
}).enabled;

export const ENABLE_CALLS = true;

// Email signatures: the settings editor, the compose / reply / AI-chat signature
// previews, and the per-message include toggle. PostHog-gated with a dev-mode
// default; override with VITE_ENABLE_EMAIL_SIGNATURES.
export const enableEmailSignatures = defineFlag({
  key: 'enable-email-signatures',
  env: 'ENABLE_EMAIL_SIGNATURES',
  default: onInDev,
});

// SidebarNext: the rebuilt app sidebar — the narrow icon rail in
// `components/app/sidebar-next` — rendered in place of `AppSidebar`.
// PostHog-gated everywhere, dev included: no dev-mode default, so `AppSidebar`
// stays the sidebar you get by default until the flag is on for you. Set
// VITE_ENABLE_SIDEBAR_NEXT=true to force the rail on locally without PostHog.
//
// The PostHog key is deliberately broader than the local names: `enable-new-app-views`
// is the rollout switch for the rebuilt app surfaces, of which this sidebar is one.
export const enableSidebarNext = defineFlag({
  key: 'enable-new-app-views',
  env: 'ENABLE_SIDEBAR_NEXT',
});

// CRM companies & contacts frontend: the Companies view + sidebar entry, the
// company/contact detail blocks, CRM mentions / quick-access, and CRM rows in
// global search. PostHog-gated (currently targeted at the Macro team in prod)
// with a dev-mode default; override with VITE_ENABLE_CRM.
export const enableCrm = defineFlag({
  key: 'enable-crm',
  env: 'ENABLE_CRM',
  default: onInDev,
});

// Reminders: the "Remind me" entry in the command menu, the soup
// context menu and the block ⋯ menu, its 'h' shortcut, and the composer modal.
// Every surface routes through `makeCreateReminderAction().canExecute`, so this
// is the single gate for all of them. PostHog-gated with a dev-mode default.
export const enableReminders = defineFlag({
  key: 'enable-reminders',
  env: 'ENABLE_REMINDERS',
  default: onInDev,
});

export const enableHistoryComponent = defineFlag({
  key: 'enable-history-component',
  env: 'ENABLE_HISTORY_COMPONENT',
  default: onInDev,
});

export const enableGitBlame = defineFlag({
  key: 'enable-git-blame',
  env: 'ENABLE_GIT_BLAME',
  default: onInDev,
});

// Inline AI editing: the floating document AI edit pill and the AI editing
// tool in the selection formatting menu.
export const enableInlineAiEditing = defineFlag({
  key: 'inline-ai-editing',
  env: 'INLINE_AI_EDITING',
  default: onInDev,
});

export const enableMultiInbox = defineFlag({
  key: 'enable-multi-inbox',
  env: 'ENABLE_MULTI_INBOX',
  default: onInDev,
});

export const enableSoupGroupBy = defineFlag({
  key: 'enable-soup-group-by',
  default: onInDev,
});

// Persist soup filters, predicates and tabs across reloads. PostHog controls
// production rollout; VITE_ENABLE_SOUP_FILTER_PERSISTENCE overrides locally.
export const enableSoupFilterPersistence = defineFlag({
  key: 'enable-soup-filter-persistence',
  env: 'ENABLE_SOUP_FILTER_PERSISTENCE',
});

export const enableTaskDuplicates = defineFlag({
  key: 'enable-task-duplicates',
  default: onInDev,
});

// Snippets: reusable markdown documents, the `c` launcher entry, and the `;`
// insert menu. PostHog-gated (currently targeted at the Macro team) with a
// dev-mode default; override with VITE_ENABLE_SNIPPETS.
export const enableSnippets = defineFlag({
  key: 'enable-snippets',
  env: 'ENABLE_SNIPPETS',
  default: onInDev,
});

export const enableSupportedSoupForeignEntities = defineFlag({
  key: 'enable-supported-soup-foreign-entities',
  default: onInDev,
});

export const enableInboxNotifiedSort = defineFlag({
  key: 'enable-inbox-notified-sort',
  env: 'ENABLE_INBOX_NOTIFIED_SORT',
  default: onInDev,
});

export const enableGraphqlSoup = defineFlag({
  key: 'enable-graphql-soup',
  env: 'ENABLE_GRAPHQL_SOUP',
});

/** Independent emergency stop. Any true env/PostHog source wins. */
export const disableBrowserTursoCache = defineFlag({
  key: 'disable-browser-turso-cache',
  env: 'DISABLE_BROWSER_TURSO_CACHE',
});

// Env is enable-space; PostHog key is disable-space. Invert at the call site.
export const enableAutoUpdateUiOverride = getFeatureFlagOverride(
  'ENABLE_AUTO_UPDATE_UI'
);
export const disableAutoUpdateUi = defineFlag({
  key: 'disable-auto-update-ui',
});

export function isAutoUpdateUiEnabled(): boolean {
  if (enableAutoUpdateUiOverride !== undefined) {
    return enableAutoUpdateUiOverride;
  }
  return !isFeatureEnabled(disableAutoUpdateUi);
}

export const enableHomeView = defineFlag({
  key: 'enable-home-view',
  default: onInDev,
});

// AI-generated recommendations on Home. Keep the whole data-owning component
// behind this gate so disabled users do not fetch notifications or start AI
// projections. Override locally with VITE_ENABLE_HOME_RECOMMENDATIONS.
export const enableHomeRecommendations = defineFlag({
  key: 'enable-home-recommendations',
  env: 'ENABLE_HOME_RECOMMENDATIONS',
  default: onInDev,
});

export const enableNewPricing = defineFlag({
  key: 'enable-new-pricing',
  env: 'ENABLE_NEW_PRICING',
  default: onInDev,
});

// Bot management in Settings, channels, and the command menu. Override locally
// with VITE_BOT_MANAGEMENT.
export const botManagement = defineFlag({
  key: 'bot-management',
  env: 'BOT_MANAGEMENT',
  default: onInDev,
});

// Onboarding v4: the full-screen stepper new users land in after signup
// (unified with /login), driving the import machinery with auto-import.
// PostHog-gated; override with VITE_ENABLE_ONBOARDING_V4. Read it through
// `useOnboardingV4Flag()` so the gate reacts when PostHog answers (and so
// callers can wait instead of treating "flags not loaded yet" as "off").
// `just run_local` sets the env to false unless `--enable-onboarding`.
export const enableOnboardingV4 = defineFlag({
  key: 'enable-onboarding-v4',
  env: 'ENABLE_ONBOARDING_V4',
  default: onInDev,
});

// Calendar UI: calendar surfaces and the elevated-permissions upgrade flow
// that re-runs Google consent for inboxes connected before the calendar
// scope existed. PostHog-gated with a dev-mode default; override with
// VITE_ENABLE_CALENDAR_UI.
export const enableCalendarUi = defineFlag({
  key: 'enable-calendar-ui',
  env: 'ENABLE_CALENDAR_UI',
  default: onInDev,
});

// Calendar event search UI: the Search view's Calendar type (and calendar
// rows) plus the in-calendar keyword search. A sub-feature of the calendar UI
// — opening a hit needs the calendar block — so it only takes effect where
// `enable-calendar-ui` is also on. PostHog-gated with a dev-mode default;
// override with VITE_ENABLE_CALENDAR_SEARCH_UI.
export const enableCalendarSearchUi = defineFlag({
  key: 'enable-calendar-search-ui',
  env: 'ENABLE_CALENDAR_SEARCH_UI',
  default: onInDev,
});

export function isCalendarSearchUiEnabled(): boolean {
  return (
    isFeatureEnabled(enableCalendarUi) &&
    isFeatureEnabled(enableCalendarSearchUi)
  );
}

// The "Enable calendar" prompt on phones. Off by default everywhere,
// including dev: the mobile toast layout drops the body and the close button,
// so the prompt lands as an undismissable one-line bar over the composer.
// Settings › Email keeps a per-inbox "Enable calendar" button, so nothing
// becomes unreachable while this is off. Flip it on in PostHog once the
// mobile layout is fixed, or locally with
// VITE_ENABLE_CALENDAR_PROMPT_MOBILE=true.
export const enableCalendarPromptMobile = defineFlag({
  key: 'enable-calendar-prompt-mobile',
  env: 'ENABLE_CALENDAR_PROMPT_MOBILE',
});

// The "Enable calendar" prompt on desktop/web, the counterpart to
// `enable-calendar-prompt-mobile`. Off by default everywhere, including dev,
// until the PostHog rollout is raised; Settings › Email keeps a per-inbox
// "Enable calendar" button, so nothing becomes unreachable while this is off.
// Override locally with VITE_ENABLE_CALENDAR_PROMPT_WEB=true.
export const enableCalendarPromptWeb = defineFlag({
  key: 'enable-calendar-prompt-web',
  env: 'ENABLE_CALENDAR_PROMPT_WEB',
});

// Sharing a personal tag with the team: the "Share with team" action on
// personal tags in Settings › Tags, and the prompt that merges into an
// existing team label when the names collide. The backend endpoints ship
// ungated, so flipping this off only hides the entry point. PostHog-gated
// with a dev-mode default; override with VITE_ENABLE_TAG_TEAM_SHARING.
export const enableTagTeamSharing = defineFlag({
  key: 'enable-tag-team-sharing',
  env: 'ENABLE_TAG_TEAM_SHARING',
  default: onInDev,
});

// The "Activity" section in the entity side panel: the entity's recent
// activity timeline from the GraphQL activity log (who did what, when).
// Purely additive — when off, the section never mounts and no activity
// query is issued. PostHog-gated with a dev-mode default; override with
// VITE_ENABLE_ENTITY_ACTIVITY_SECTION.
export const enableEntityActivitySection = defineFlag({
  key: 'enable-entity-activity-section',
  env: 'ENABLE_ENTITY_ACTIVITY_SECTION',
  default: onInDev,
});

// The Activity view: the user's own activity feed from the GraphQL activity
// log, replacing the retired soup/notification-derived timeline. Gates the
// view (the /activity route redirects to the inbox when off) and its
// sidebar entry. PostHog-gated with a dev-mode default; override with
// VITE_ENABLE_ACTIVITY_FEED.
export const enableActivityFeed = defineFlag({
  key: 'enable-activity-feed',
  env: 'ENABLE_ACTIVITY_FEED',
  default: onInDev,
});

// AI agents: the Macro Coder mention entry and the folded agent-session view
// in channels. Override with VITE_ENABLE_CHAT_V3_AGENTS.
export const enableChatV3Agents = defineFlag({
  key: 'enable-chat-v3-agents',
  env: 'ENABLE_CHAT_V3_AGENTS',
  default: onInDev,
});

// The `@cursor` mention entry: agent sessions served by Cursor cloud agents
// on Macro's Cursor account. PostHog-gated per user; the backend additionally
// restricts these sessions to @macro.com senders. Override with
// VITE_ENABLE_CURSOR_AGENTS.
export const enableCursorAgents = defineFlag({
  key: 'enable-cursor-agents',
  env: 'ENABLE_CURSOR_AGENTS',
  default: onInDev,
});

// The Recent view: the touched-by-me feed (everything the viewer mutated,
// newest own-touch first). Gates the view (the route redirects to the inbox
// when off) and its sidebar entry. PostHog-gated with a dev-mode default;
// override with VITE_ENABLE_RECENT_VIEW.
export const enableRecentView = defineFlag({
  key: 'enable-recent-view',
  env: 'ENABLE_RECENT_VIEW',
  default: onInDev,
});

// Settings › Notifications: the dedicated preferences tab (delivery, per-type
// opt-outs, muted items). When off, the tab is hidden and Account keeps the
// existing desktop/mobile toggle. PostHog-gated with a dev-mode default;
// override with VITE_ENABLE_NOTIFICATION_SETTINGS.
export const enableNotificationSettings = defineFlag({
  key: 'enable-notification-settings',
  env: 'ENABLE_NOTIFICATION_SETTINGS',
  default: onInDev,
});
