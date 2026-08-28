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

type FeatureFlagValue = 'true' | 'false' | undefined;

/**
 * Reads a `VITE_<flagName>` env override. Returns `undefined` when unset, so
 * callers can fall through to PostHog rather than forcing the flag off.
 */
export function getFeatureFlagOverride(flagName: string): boolean | undefined {
  const envKey = `VITE_${flagName}` as const;
  const value = import.meta.env[envKey] as FeatureFlagValue;

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
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

/**
 * This constant reflects whether the app is running in production mode with prod backend environment
 *
 * @returns true in macro.com, false otherwise
 */
export const PROD_MODE_ENV = import.meta.env.MODE === 'production';

export const ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE = resolveFeatureFlag(
  'ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE',
  true
);

export const ENABLE_PDF_LOCATION_AUTOSAVE = resolveFeatureFlag(
  'ENABLE_PDF_LOCATION_AUTOSAVE',
  true
);

export const ENABLE_PDF_TABS = resolveFeatureFlag('ENABLE_PDF_TABS', true);

export const ENABLE_PDF_MARKUP = resolveFeatureFlag('ENABLE_PDF_MARKUP', true);

// NOTE: disabling scripting: event listener needs to be properly unmounted first
// this is the offending line in our pdfjs repo, which has been fixed in the upstream
// https://github.com/macro-inc/pdf.js/blob/d22768d78ebaaf038707d3d926992a7aeb88e730/web/pdf_scripting_manager.js?plain=1#L59
export const ENABLE_SCRIPTING = resolveFeatureFlag('ENABLE_SCRIPTING', false);

export const ENABLE_PDF_MULTISPLIT = resolveFeatureFlag(
  'ENABLE_PDF_MULTISPLIT',
  true
);

export const ENABLE_PROJECT_SHARING = resolveFeatureFlag(
  'ENABLE_PROJECT_SHARING',
  true
);

export const ENABLE_CANVAS_IMAGES = resolveFeatureFlag(
  'ENABLE_CANVAS_IMAGES',
  true
);

export const ENABLE_CANVAS_FILES = resolveFeatureFlag(
  'ENABLE_CANVAS_FILES',
  true
);

export const ENABLE_CANVAS_TEXT = resolveFeatureFlag(
  'ENABLE_CANVAS_TEXT',
  true
);

export const ENABLE_LIVE_INDICATORS = resolveFeatureFlag(
  'ENABLE_LIVE_INDICATORS',
  true
);

const _ENABLE_CONTACTS = resolveFeatureFlag('ENABLE_CONTACTS', true);
const _ENABLE_GMAIL_BASED_CONTACTS = resolveFeatureFlag(
  'ENABLE_GMAIL_BASED_CONTACTS',
  DEV_MODE_ENV
);

export const ENABLE_PROFILE_PICTURES = resolveFeatureFlag(
  'ENABLE_PROFILE_PICTURES',
  true
);

export const ENABLE_VIDEO_BLOCK = resolveFeatureFlag(
  'ENABLE_VIDEO_BLOCK',
  true
);

export const ENABLE_DOCX_TO_PDF = resolveFeatureFlag(
  'ENABLE_DOCX_TO_PDF',
  true
);

export const ENABLE_MARKDOWN_LIVE_COLLABORATION = resolveFeatureFlag(
  'ENABLE_MARKDOWN_LIVE_COLLABORATION',
  true
);

export const ENABLE_EMAIL = resolveFeatureFlag('ENABLE_EMAIL', true);

// Email signatures: the settings editor, the compose / reply / AI-chat signature
// previews, and the per-message include toggle. PostHog-gated with a dev-mode
// default; override with VITE_ENABLE_EMAIL_SIGNATURES.
export const ENABLE_EMAIL_SIGNATURES_FLAG = 'enable-email-signatures';
// Honor an explicit VITE_ENABLE_EMAIL_SIGNATURES=false (don't coerce it to
// undefined), else default on in dev and defer to PostHog in prod.
export const ENABLE_EMAIL_SIGNATURES_OVERRIDE =
  getFeatureFlagOverride('ENABLE_EMAIL_SIGNATURES') ??
  (DEV_MODE_ENV ? true : undefined);

/**
 * Non-reactive check for imperative call sites. For reactive UI, prefer
 * `useFeatureFlag(ENABLE_EMAIL_SIGNATURES_FLAG, { enabledOverride: ENABLE_EMAIL_SIGNATURES_OVERRIDE })`.
 */
export function ENABLE_EMAIL_SIGNATURES(): boolean {
  if (ENABLE_EMAIL_SIGNATURES_OVERRIDE !== undefined) {
    return ENABLE_EMAIL_SIGNATURES_OVERRIDE;
  }
  return (
    analytics.posthog.isFeatureEnabled(ENABLE_EMAIL_SIGNATURES_FLAG) ?? false
  );
}

// CRM companies & contacts frontend: the Companies view + sidebar entry, the
// company/contact detail blocks, CRM mentions / quick-access, and CRM rows in
// global search. PostHog-gated (currently targeted at the Macro team in prod)
// with a dev-mode default; override with VITE_ENABLE_CRM.
export const ENABLE_CRM_FLAG = 'enable-crm';
export const ENABLE_CRM_OVERRIDE =
  resolveFeatureFlag('ENABLE_CRM', DEV_MODE_ENV) || undefined;

/**
 * Non-reactive check for imperative call sites. For reactive UI, prefer
 * `useFeatureFlag(ENABLE_CRM_FLAG, { enabledOverride: ENABLE_CRM_OVERRIDE })`.
 */
export function ENABLE_CRM(): boolean {
  if (ENABLE_CRM_OVERRIDE !== undefined) return ENABLE_CRM_OVERRIDE;
  return analytics.posthog.isFeatureEnabled(ENABLE_CRM_FLAG) ?? false;
}

// Reminders: the "Remind me" entry in the command menu, the soup
// context menu and the block ⋯ menu, its 'h' shortcut, and the composer modal.
// Every surface routes through `makeCreateReminderAction().canExecute`, so this
// is the single gate for all of them. PostHog-gated with a dev-mode default.
export const ENABLE_REMINDERS_FLAG = 'enable-reminders';
// Read statically rather than through `getFeatureFlagOverride`: Vite replaces
// `import.meta.env.VITE_X` by text substitution at build time, so the dynamic
// `import.meta.env[key]` lookup that helper does can come back undefined in a
// production bundle. Same form as VITE_ENABLE_BROWSER_OTEL in observability/.
//
// Written out rather than using `|| undefined` so an explicit
// VITE_ENABLE_REMINDERS=false stays false instead of being coerced to undefined
// and falling through to PostHog.
const REMINDERS_ENV_OVERRIDE = import.meta.env.VITE_ENABLE_REMINDERS;
export const ENABLE_REMINDERS_OVERRIDE: boolean | undefined =
  REMINDERS_ENV_OVERRIDE === 'true'
    ? true
    : REMINDERS_ENV_OVERRIDE === 'false'
      ? false
      : DEV_MODE_ENV
        ? true
        : undefined;

/**
 * Non-reactive check for imperative call sites. For reactive UI, prefer
 * `useFeatureFlag(ENABLE_REMINDERS_FLAG, { enabledOverride: ENABLE_REMINDERS_OVERRIDE })`.
 */
export function ENABLE_REMINDERS(): boolean {
  if (ENABLE_REMINDERS_OVERRIDE !== undefined) {
    return ENABLE_REMINDERS_OVERRIDE;
  }
  return analytics.posthog.isFeatureEnabled(ENABLE_REMINDERS_FLAG) ?? false;
}

export const ENABLE_BLOCK_IN_BLOCK = resolveFeatureFlag(
  'ENABLE_BLOCK_IN_BLOCK',
  true
);

export const ENABLE_SEARCH_SERVICE = resolveFeatureFlag(
  'ENABLE_SEARCH_SERVICE',
  true
);

export const ENABLE_MARKDOWN_DIFF = resolveFeatureFlag(
  'ENABLE_MARKDOWN_DIFF',
  true
);

export const ENABLE_HISTORY_COMPONENT_FLAG = 'enable-history-component';
export const ENABLE_HISTORY_COMPONENT_OVERRIDE =
  resolveFeatureFlag('ENABLE_HISTORY_COMPONENT', DEV_MODE_ENV) || undefined;

export function ENABLE_HISTORY_COMPONENT(): boolean {
  if (ENABLE_HISTORY_COMPONENT_OVERRIDE !== undefined) {
    return ENABLE_HISTORY_COMPONENT_OVERRIDE;
  }

  return (
    analytics.posthog.isFeatureEnabled(ENABLE_HISTORY_COMPONENT_FLAG) ?? false
  );
}

export const ENABLE_BEARER_TOKEN_AUTH = resolveFeatureFlag(
  'ENABLE_BEARER_TOKEN_AUTH',
  false
);

export const ENABLE_GIT_BLAME_FLAG = 'enable-git-blame';
export const ENABLE_GIT_BLAME_OVERRIDE =
  resolveFeatureFlag('ENABLE_GIT_BLAME', DEV_MODE_ENV) || undefined;

export function ENABLE_GIT_BLAME(): boolean {
  if (ENABLE_GIT_BLAME_OVERRIDE !== undefined) return ENABLE_GIT_BLAME_OVERRIDE;
  return analytics.posthog.isFeatureEnabled(ENABLE_GIT_BLAME_FLAG) ?? false;
}

export const ENABLE_MARKDOWN_SEARCH_TEXT = resolveFeatureFlag(
  'ENABLE_MARKDOWN_SEARCH_TEXT',
  DEV_MODE_ENV
);

export const CANVAS_SVG_IMPORT = resolveFeatureFlag('CANVAS_SVG_IMPORT', true);

export const ENABLE_CANVAS_VIDEO = resolveFeatureFlag(
  'ENABLE_CANVAS_VIDEO',
  true
);

// TODO: figure out why the image does not load into canvas after upload
export const ENABLE_CANVAS_HEIC = resolveFeatureFlag(
  'ENABLE_CANVAS_HEIC',
  false
);

// TODO - comments are not stable in markdown multiplayer, they will need more work.
export const ENABLE_MARKDOWN_COMMENTS = resolveFeatureFlag(
  'ENABLE_MARKDOWN_COMMENTS',
  true
);

export const ENABLE_REFERENCES_MODAL = resolveFeatureFlag(
  'ENABLE_REFERENCES_MODAL',
  true
);

export const ENABLE_MENTION_TRACKING = resolveFeatureFlag(
  'ENABLE_MENTION_TRACKING',
  true
);

const _ENABLE_SEARCH_PAGINATION = resolveFeatureFlag(
  'ENABLE_SEARCH_PAGINATION',
  true
);

export const ENABLE_CHAT_CHANNEL_ATTACHMENT = resolveFeatureFlag(
  'ENABLE_CHAT_CHANNEL_ATTACHMENT',
  true
);

export const ENABLE_SVG_PREVIEW = resolveFeatureFlag(
  'ENABLE_SVG_PREVIEW',
  true
);

export const USE_WIDE_ICONS = resolveFeatureFlag('USE_WIDE_ICONS', true);

export const ENABLE_ANIMATED_ICONS = resolveFeatureFlag(
  'ENABLE_ANIMATED_ICONS',
  true
);

const _ENABLE_PROPERTY_DISPLAY = resolveFeatureFlag(
  'ENABLE_PROPERTY_DISPLAY',
  DEV_MODE_ENV
);
const _ENABLE_PROPERTY_SORT = resolveFeatureFlag(
  'ENABLE_PROPERTY_SORT',
  DEV_MODE_ENV
);
const _ENABLE_PROPERTY_FILTER = resolveFeatureFlag(
  'ENABLE_PROPERTY_FILTER',
  DEV_MODE_ENV
);

// TODO: re-enable when supported in backend
const _ENABLE_SOUP_FROM_FILTER = resolveFeatureFlag(
  'ENABLE_SOUP_FROM_FILTER',
  false
);

const _ENABLE_DOCK_NOTITIFCATIONS = resolveFeatureFlag(
  'ENABLE_DOCK_NOTITIFCATIONS',
  DEV_MODE_ENV
);
export const ENABLE_TTFT = resolveFeatureFlag('ENABLE_TTFT', DEV_MODE_ENV);

export const ENABLE_MULTI_INBOX_OVERRIDE =
  resolveFeatureFlag('ENABLE_MULTI_INBOX', DEV_MODE_ENV) || undefined;

export const ENABLE_INBOX_RESYNC = resolveFeatureFlag(
  'ENABLE_INBOX_RESYNC',
  false
);

export const ENABLE_INBOX_SYNC_STATUS = resolveFeatureFlag(
  'ENABLE_INBOX_SYNC_STATUS',
  true
);

const _ENABLE_TASKS_TABS = resolveFeatureFlag('ENABLE_TASKS_TABS', true);

export const ENABLE_EMAIL_SHARING = resolveFeatureFlag(
  'ENABLE_EMAIL_SHARING',
  true
);

export const ENABLE_DOCUMENT_MENTION_NOTIFICATIONS = resolveFeatureFlag(
  'ENABLE_DOCUMENT_MENTION_NOTIFICATIONS',
  DEV_MODE_ENV
);

// Auto expand stand-alone mentions to richer previews in channels
export const ENABLE_STATIC_DOCUMENT_CARDS = resolveFeatureFlag(
  'ENABLE_STATIC_DOCUMENT_CARDS',
  false
);

export const ENABLE_MARKDOWN_AI_GENERATE = resolveFeatureFlag(
  'ENABLE_MARKDOWN_AI_GENERATE',
  false
);

export const ENABLE_UNIFIED_LIST_AI_INPUT = resolveFeatureFlag(
  'ENABLE_UNIFIED_LIST_AI_INPUT',
  true
);

// Inline AI editing: the floating document AI edit pill and the AI editing
// tool in the selection formatting menu. Gated by PostHog; use the reactive
// `useFeatureFlag(INLINE_AI_EDITING_FLAG, { enabledOverride: INLINE_AI_EDITING_OVERRIDE })`.
export const INLINE_AI_EDITING_FLAG = 'inline-ai-editing';
export const INLINE_AI_EDITING_OVERRIDE =
  resolveFeatureFlag('INLINE_AI_EDITING', DEV_MODE_ENV) || undefined;

export const ENABLE_EMAIL_SCHEDULED_SEND = resolveFeatureFlag(
  'ENABLE_EMAIL_SCHEDULED_SEND',
  true
);

const _ENABLE_AI_AUTO_TAB_ATTACHMENTS = resolveFeatureFlag(
  'ENABLE_AI_AUTO_TAB_ATTACHMENTS',
  true
);

export const ENABLE_FEATURED_SEARCH_RESULTS = resolveFeatureFlag(
  'ENABLE_FEATURED_SEARCH_RESULTS',
  true
);

const _ENABLE_SEARCH_QUERY_OPERATORS = resolveFeatureFlag(
  'ENABLE_SEARCH_QUERY_OPERATORS',
  false
);

const ENABLE_NEW_CHANNELS_OVERRIDE = true;

function _ENABLE_NEW_CHANNELS(): boolean {
  if (ENABLE_NEW_CHANNELS_OVERRIDE !== undefined) {
    return ENABLE_NEW_CHANNELS_OVERRIDE;
  }

  return analytics.posthog.isFeatureEnabled('enable-new-channels') ?? false;
}

export const ENABLE_PROXY_EMAIL_IMAGES = resolveFeatureFlag(
  'ENABLE_PROXY_EMAIL_IMAGES',
  true
);

export const ENABLE_CLIENT_EMAIL_SIGNAL_FILTER = resolveFeatureFlag(
  'ENABLE_CLIENT_EMAIL_SIGNAL_FILTER',
  false
);

export const ENABLE_APP_STORE_QR_CODE = resolveFeatureFlag(
  'ENABLE_APP_STORE_QR_CODE',
  true
);

export const ENABLE_PR_DISCUSSION_INPUT = resolveFeatureFlag(
  'ENABLE_PR_DISCUSSION_INPUT',
  false
);

export const USE_MACRO_PR_SUMMARY_BLOCK = resolveFeatureFlag(
  'USE_MACRO_PR_SUMMARY_BLOCK',
  true
);

// skips over posthog and sets the ENABLE_CALLS feature to true if we are in dev mode
const ENABLE_CALLS_OVERRIDE = true;

export function ENABLE_CALLS(): boolean {
  if (ENABLE_CALLS_OVERRIDE !== undefined) {
    return ENABLE_CALLS_OVERRIDE;
  }

  return analytics.posthog.isFeatureEnabled('enable-calls') ?? false;
}

export const ENABLE_NEW_ONBOARDING_OVERRIDE = DEV_MODE_ENV ? true : undefined;

export const ENABLE_INVITE_TEAM_ONBOARDING_OVERRIDE = DEV_MODE_ENV
  ? true
  : undefined;

export const ENABLE_TEAM_INVITE_TIERS_OVERRIDE = DEV_MODE_ENV
  ? true
  : undefined;

export const ENABLE_SOUP_GROUP_BY_OVERRIDE = DEV_MODE_ENV ? true : undefined;

// Persist soup filters, predicates and tabs across reloads. PostHog controls
// production rollout; VITE_ENABLE_SOUP_FILTER_PERSISTENCE overrides locally.
export const ENABLE_SOUP_FILTER_PERSISTENCE_FLAG =
  'enable-soup-filter-persistence';
export const ENABLE_SOUP_FILTER_PERSISTENCE_OVERRIDE = getFeatureFlagOverride(
  'ENABLE_SOUP_FILTER_PERSISTENCE'
);

export const ENABLE_TASK_DUPLICATES_FLAG = 'enable-task-duplicates';
export const ENABLE_TASK_DUPLICATES_OVERRIDE = DEV_MODE_ENV ? true : undefined;

// Snippets: reusable markdown documents, the `c` launcher entry, and the `;`
// insert menu. PostHog-gated (currently targeted at the Macro team) with a
// dev-mode default; override with VITE_ENABLE_SNIPPETS.
export const ENABLE_SNIPPETS_FLAG = 'enable-snippets';
export const ENABLE_SNIPPETS_OVERRIDE =
  resolveFeatureFlag('ENABLE_SNIPPETS', DEV_MODE_ENV) || undefined;

/** Non-reactive check for imperative call sites (e.g. editor key handlers). */
export function ENABLE_SNIPPETS(): boolean {
  if (ENABLE_SNIPPETS_OVERRIDE !== undefined) {
    return ENABLE_SNIPPETS_OVERRIDE;
  }

  return analytics.posthog.isFeatureEnabled(ENABLE_SNIPPETS_FLAG) ?? false;
}

export const ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_FLAG =
  'enable-supported-soup-foreign-entities';
export const ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE = DEV_MODE_ENV
  ? true
  : undefined;

export const ENABLE_GRAPHQL_SOUP_FLAG = 'enable-graphql-soup';
export const ENABLE_GRAPHQL_SOUP_OVERRIDE = getFeatureFlagOverride(
  'ENABLE_GRAPHQL_SOUP'
);

const parseBooleanOverride = (value: unknown): boolean | undefined =>
  value === 'true' ? true : value === 'false' ? false : undefined;

/** Controls the cache-warming GraphQL soup backfill. */
export const ENABLE_GRAPHQL_BACKFILL = resolveFeatureFlag(
  'ENABLE_GRAPHQL_BACKFILL',
  true
);

/** Independent emergency stop. Any true env/PostHog source wins. */
export const DISABLE_BROWSER_TURSO_CACHE_FLAG = 'disable-browser-turso-cache';
const DISABLE_BROWSER_TURSO_CACHE_ENV = import.meta.env
  .VITE_DISABLE_BROWSER_TURSO_CACHE;
export const DISABLE_BROWSER_TURSO_CACHE_OVERRIDE = parseBooleanOverride(
  DISABLE_BROWSER_TURSO_CACHE_ENV
);

/**
 * Non-reactive check for imperative call sites (e.g. the soup GraphQL
 * client's normalized-cache gate). Env override first (dev), else the same
 * PostHog flag that gates the GraphQL transport — so cache and transport
 * activate together in previews/production.
 */
export function ENABLE_GRAPHQL_SOUP(): boolean {
  if (ENABLE_GRAPHQL_SOUP_OVERRIDE !== undefined) {
    return ENABLE_GRAPHQL_SOUP_OVERRIDE;
  }

  return analytics.posthog.isFeatureEnabled(ENABLE_GRAPHQL_SOUP_FLAG) ?? false;
}

export const DISABLE_AUTO_UPDATE_UI_FLAG = 'disable-auto-update-ui';
export const ENABLE_AUTO_UPDATE_UI_OVERRIDE = getFeatureFlagOverride(
  'ENABLE_AUTO_UPDATE_UI'
);

export function ENABLE_AUTO_UPDATE_UI(): boolean {
  if (ENABLE_AUTO_UPDATE_UI_OVERRIDE !== undefined) {
    return ENABLE_AUTO_UPDATE_UI_OVERRIDE;
  }

  return !(
    analytics.posthog.isFeatureEnabled(DISABLE_AUTO_UPDATE_UI_FLAG) ?? false
  );
}

export const ENABLE_CALLKIT = resolveFeatureFlag('ENABLE_CALLKIT', true);

export const ENABLE_MARKDOWN_SIDE_PANEL = resolveFeatureFlag(
  'ENABLE_MARKDOWN_SIDE_PANEL',
  true
);

export const ENABLE_REFOCUS_HIGHLIGHT = resolveFeatureFlag(
  'ENABLE_REFOCUS_HIGHLIGHT',
  true
);

export const ENABLE_CREATE_PROPERTY = resolveFeatureFlag(
  'ENABLE_CREATE_PROPERTY',
  true
);

export const ENABLE_HOME_OVERRIDE = DEV_MODE_ENV ? true : undefined;

// AI-generated recommendations on Home. Keep the whole data-owning component
// behind this gate so disabled users do not fetch notifications or start AI
// projections. Override locally with VITE_ENABLE_HOME_RECOMMENDATIONS.
export const ENABLE_HOME_RECOMMENDATIONS_FLAG = 'enable-home-recommendations';
export const ENABLE_HOME_RECOMMENDATIONS_OVERRIDE =
  resolveFeatureFlag('ENABLE_HOME_RECOMMENDATIONS', DEV_MODE_ENV) || undefined;

export const ENABLE_NEW_PRICING_OVERRIDE =
  resolveFeatureFlag('ENABLE_NEW_PRICING', DEV_MODE_ENV) || undefined;

// Channel mode where replying and editing do not happen inline, but in a single unified input instead.
export const UNIFIED_CHANNEL_INPUT = resolveFeatureFlag(
  'UNIFIED_CHANNEL_INPUT',
  false
);

// Bot management in Settings, channels, and the command menu. Override locally
// with VITE_BOT_MANAGEMENT.
export const BOT_MANAGEMENT_FLAG = 'bot-management';
export const BOT_MANAGEMENT_OVERRIDE =
  resolveFeatureFlag('BOT_MANAGEMENT', DEV_MODE_ENV) || undefined;

// Onboarding v4: the full-screen stepper new users land in after signup
// (unified with /login), driving the import machinery with auto-import.
// PostHog-gated; override with VITE_ENABLE_ONBOARDING_V4. Read it through
// `useOnboardingV4Flag()` so the gate reacts when PostHog answers (and so
// callers can wait instead of treating "flags not loaded yet" as "off").
export const ENABLE_ONBOARDING_V4_FLAG = 'enable-onboarding-v4';
// Honor an explicit VITE_ENABLE_ONBOARDING_V4=false (don't coerce it to
// undefined), else default on in dev and defer to PostHog in prod.
// `just run_local` sets the env to false unless `--enable-onboarding`.
export const ENABLE_ONBOARDING_V4_OVERRIDE =
  getFeatureFlagOverride('ENABLE_ONBOARDING_V4') ??
  (DEV_MODE_ENV ? true : undefined);

// Calendar UI: calendar surfaces and the elevated-permissions upgrade flow
// that re-runs Google consent for inboxes connected before the calendar
// scope existed. PostHog-gated with a dev-mode default; override with
// VITE_ENABLE_CALENDAR_UI.
export const ENABLE_CALENDAR_UI_FLAG = 'enable-calendar-ui';
export const ENABLE_CALENDAR_UI_OVERRIDE =
  getFeatureFlagOverride('ENABLE_CALENDAR_UI') ??
  (DEV_MODE_ENV ? true : undefined);

/**
 * Non-reactive check for imperative call sites (notification navigation).
 * For reactive UI, prefer `useCalendarUiFlag()`.
 */
export function ENABLE_CALENDAR_UI(): boolean {
  if (ENABLE_CALENDAR_UI_OVERRIDE !== undefined) {
    return ENABLE_CALENDAR_UI_OVERRIDE;
  }
  return analytics.posthog.isFeatureEnabled(ENABLE_CALENDAR_UI_FLAG) ?? false;
}

// Calendar event search UI: the Search view's Calendar type (and calendar
// rows) plus the in-calendar keyword search. A sub-feature of the calendar UI
// — opening a hit needs the calendar block — so it only takes effect where
// `enable-calendar-ui` is also on. PostHog-gated with a dev-mode default;
// override with VITE_ENABLE_CALENDAR_SEARCH_UI.
export const ENABLE_CALENDAR_SEARCH_UI_FLAG = 'enable-calendar-search-ui';
export const ENABLE_CALENDAR_SEARCH_UI_OVERRIDE =
  getFeatureFlagOverride('ENABLE_CALENDAR_SEARCH_UI') ??
  (DEV_MODE_ENV ? true : undefined);

/**
 * Non-reactive check for imperative call sites (soup filter presets). Gated by
 * the calendar UI too. For reactive UI, prefer `useCalendarSearchUiFlag()`.
 */
export function ENABLE_CALENDAR_SEARCH_UI(): boolean {
  if (!ENABLE_CALENDAR_UI()) {
    return false;
  }
  if (ENABLE_CALENDAR_SEARCH_UI_OVERRIDE !== undefined) {
    return ENABLE_CALENDAR_SEARCH_UI_OVERRIDE;
  }
  return (
    analytics.posthog.isFeatureEnabled(ENABLE_CALENDAR_SEARCH_UI_FLAG) ?? false
  );
}

// The "Enable calendar" prompt on phones. Off by default everywhere,
// including dev: the mobile toast layout drops the body and the close button,
// so the prompt lands as an undismissable one-line bar over the composer.
// Settings › Email keeps a per-inbox "Enable calendar" button, so nothing
// becomes unreachable while this is off. Flip it on in PostHog once the
// mobile layout is fixed, or locally with
// VITE_ENABLE_CALENDAR_PROMPT_MOBILE=true.
export const ENABLE_CALENDAR_PROMPT_MOBILE_FLAG =
  'enable-calendar-prompt-mobile';
export const ENABLE_CALENDAR_PROMPT_MOBILE_OVERRIDE = getFeatureFlagOverride(
  'ENABLE_CALENDAR_PROMPT_MOBILE'
);

// The "Enable calendar" prompt on desktop/web, the counterpart to
// `enable-calendar-prompt-mobile`. Off by default everywhere, including dev,
// until the PostHog rollout is raised; Settings › Email keeps a per-inbox
// "Enable calendar" button, so nothing becomes unreachable while this is off.
// Override locally with VITE_ENABLE_CALENDAR_PROMPT_WEB=true.
export const ENABLE_CALENDAR_PROMPT_WEB_FLAG = 'enable-calendar-prompt-web';
export const ENABLE_CALENDAR_PROMPT_WEB_OVERRIDE = getFeatureFlagOverride(
  'ENABLE_CALENDAR_PROMPT_WEB'
);

// Sharing a personal tag with the team: the "Share with team" action on
// personal tags in Settings › Tags, and the prompt that merges into an
// existing team label when the names collide. The backend endpoints ship
// ungated, so flipping this off only hides the entry point. PostHog-gated
// with a dev-mode default; override with VITE_ENABLE_TAG_TEAM_SHARING.
export const ENABLE_TAG_TEAM_SHARING_FLAG = 'enable-tag-team-sharing';
export const ENABLE_TAG_TEAM_SHARING_OVERRIDE =
  getFeatureFlagOverride('ENABLE_TAG_TEAM_SHARING') ??
  (DEV_MODE_ENV ? true : undefined);

// The "Activity" section in the entity side panel: the entity's recent
// activity timeline from the GraphQL activity log (who did what, when).
// Purely additive — when off, the section never mounts and no activity
// query is issued. PostHog-gated with a dev-mode default; override with
// VITE_ENABLE_ENTITY_ACTIVITY_SECTION.
export const ENABLE_ENTITY_ACTIVITY_SECTION_FLAG =
  'enable-entity-activity-section';
export const ENABLE_ENTITY_ACTIVITY_SECTION_OVERRIDE =
  getFeatureFlagOverride('ENABLE_ENTITY_ACTIVITY_SECTION') ??
  (DEV_MODE_ENV ? true : undefined);

// The Activity view: the user's own activity feed from the GraphQL activity
// log, replacing the retired soup/notification-derived timeline. Gates the
// view (the /activity route redirects to the inbox when off) and its
// sidebar entry. PostHog-gated with a dev-mode default; override with
// VITE_ENABLE_ACTIVITY_FEED.
export const ENABLE_ACTIVITY_FEED_FLAG = 'enable-activity-feed';
export const ENABLE_ACTIVITY_FEED_OVERRIDE =
  getFeatureFlagOverride('ENABLE_ACTIVITY_FEED') ??
  (DEV_MODE_ENV ? true : undefined);

// AI agents: the Macro Coder mention entry and the folded agent-session view
// in channels. Override with VITE_ENABLE_CHAT_V3_AGENTS.
export const ENABLE_CHAT_V3_AGENTS_FLAG = 'enable-chat-v3-agents';
export const ENABLE_CHAT_V3_AGENTS_OVERRIDE =
  getFeatureFlagOverride('ENABLE_CHAT_V3_AGENTS') ??
  (DEV_MODE_ENV ? true : undefined);
export function ENABLE_CHAT_V3_AGENTS(): boolean {
  if (ENABLE_CHAT_V3_AGENTS_OVERRIDE !== undefined) {
    return ENABLE_CHAT_V3_AGENTS_OVERRIDE;
  }

  return (
    analytics.posthog.isFeatureEnabled(ENABLE_CHAT_V3_AGENTS_FLAG) ?? false
  );
}

// The `@cursor` mention entry: agent sessions served by Cursor cloud agents
// on Macro's Cursor account. PostHog-gated per user; the backend additionally
// restricts these sessions to @macro.com senders. Override with
// VITE_ENABLE_CURSOR_AGENTS.
export const ENABLE_CURSOR_AGENTS_FLAG = 'enable-cursor-agents';
export const ENABLE_CURSOR_AGENTS_OVERRIDE =
  getFeatureFlagOverride('ENABLE_CURSOR_AGENTS') ??
  (DEV_MODE_ENV ? true : undefined);
export function ENABLE_CURSOR_AGENTS(): boolean {
  if (ENABLE_CURSOR_AGENTS_OVERRIDE !== undefined) {
    return ENABLE_CURSOR_AGENTS_OVERRIDE;
  }

  return analytics.posthog.isFeatureEnabled(ENABLE_CURSOR_AGENTS_FLAG) ?? false;
}

// The Recent view: the touched-by-me feed (everything the viewer mutated,
// newest own-touch first). Gates the view (the route redirects to the inbox
// when off) and its sidebar entry. PostHog-gated with a dev-mode default;
// override with VITE_ENABLE_RECENT_VIEW.
export const ENABLE_RECENT_VIEW_FLAG = 'enable-recent-view';
export const ENABLE_RECENT_VIEW_OVERRIDE =
  getFeatureFlagOverride('ENABLE_RECENT_VIEW') ??
  (DEV_MODE_ENV ? true : undefined);

// Settings › Notifications: the dedicated preferences tab (delivery, per-type
// opt-outs, muted items). When off, the tab is hidden and Account keeps the
// existing desktop/mobile toggle. PostHog-gated with a dev-mode default;
// override with VITE_ENABLE_NOTIFICATION_SETTINGS.
export const ENABLE_NOTIFICATION_SETTINGS_FLAG = 'enable-notification-settings';
export const ENABLE_NOTIFICATION_SETTINGS_OVERRIDE =
  getFeatureFlagOverride('ENABLE_NOTIFICATION_SETTINGS') ??
  (DEV_MODE_ENV ? true : undefined);
