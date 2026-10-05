import { agentsRouteSegments } from '@app/features/agents-view/core/route';
import { agentDetailSearch } from '@app/features/block-agent/agent-route';
import { SPREADSHEET_COMMENT_PARAMS } from '@app/features/block-spreadsheet/core/spreadsheet-comments';
import {
  CALENDAR_ROUTE_ID,
  CALENDAR_SEARCH_NAMESPACE,
  calendarPeriodParams,
  calendarPeriodPath,
} from '@app/features/calendar-view/calendar-url';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import { changesSearch } from '@app/features/changes/changes-search';
import { driveDetailTrailSchema } from '@app/features/drive-view/primitives/drive-detail-trail';
import {
  DRIVE_DOCUMENT_TYPES,
  driveDocumentBlockType,
} from '@app/features/drive-view/primitives/drive-route-schema';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '@app/features/email-thread/core/location';
import {
  HOME_PREVIEW_SEARCH_NAMESPACES,
  homeBaseBlockType,
  homePreviewRouteParams,
} from '@app/features/home/home-route-schema';
import { reviewsTabSearch } from '@app/features/reviews-view/reviews-tab-search';
import {
  ROUTINE_CREATE_ROUTE_ID,
  ROUTINE_DETAIL_ROUTE_ID,
  ROUTINES_ROUTE_ID,
} from '@app/features/routines/routine-navigation';
import { defineRoute, type Entry, routeParams } from '@app/lib/split-router';
import { callDetailSearch } from '@block-call/call-route';
import { URL_PARAMS as CALL_URL_PARAMS } from '@block-call/constants';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as MARKDOWN_URL_PARAMS } from '@block-md/constants';
import { markdownDetailSearch } from '@block-md/markdown-route';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import { pdfDetailSearch } from '@block-pdf/pdf-route';
import { decodeLegacyPair } from '@components/app/split-layout/split-router/legacy-route';
import { uuidRouteReference } from '@components/app/split-layout/split-router/mention-links';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import {
  settingsSlugToTab,
  settingsTabToSlug,
} from '@core/constant/settingsTabsConfig';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { z } from 'zod';
import { APP_ROUTE_ID, NOT_FOUND_ROUTE_ID } from './app-route';

export const EMAIL_SIGNUP_CALLBACK_PATH = '/email-signup-callback';
export const INBOX_LINK_CALLBACK_PATH = '/inbox-link-callback';

// Pages outside the split layout. They keep the whole query.

export const baseRoute = defineRoute({
  id: 'base',
  path: '',
  externalSearch: '*',
});

export const publicBookingRoute = defineRoute({
  id: 'public-booking',
  path: 'book/:profile/:slug?',
  externalSearch: '*',
});

export const bookingReceiptRoute = defineRoute({
  id: 'booking-receipt',
  path: 'booking/:id',
  externalSearch: '*',
});

export const meetRoute = defineRoute({
  id: 'meet',
  path: 'meet/*path',
  externalSearch: '*',
});

export const taskSlugRoute = defineRoute({
  id: 'task-slug',
  path: 'task-slug/:taskSlug',
  externalSearch: '*',
});

export const signupRoute = defineRoute({
  id: 'signup',
  path: 'signup',
  externalSearch: '*',
});

export const emailSignupCallbackRoute = defineRoute({
  id: 'email-signup-callback',
  path: EMAIL_SIGNUP_CALLBACK_PATH,
  externalSearch: '*',
});

export const inboxLinkCallbackRoute = defineRoute({
  id: 'inbox-link-callback',
  path: INBOX_LINK_CALLBACK_PATH,
  externalSearch: '*',
});

export const loginPopupSuccessRoute = defineRoute({
  id: 'login-popup-success',
  path: 'login/popup/success',
  externalSearch: '*',
});

export const loginRoute = defineRoute({
  id: 'login',
  path: 'login',
  externalSearch: '*',
});

export const welcomeRoute = defineRoute({
  id: 'welcome',
  path: 'welcome',
  externalSearch: '*',
});

/**
 * Mobile-web visitors can't sign up on a phone, so instead of pushing them
 * through Google SSO + onboarding we capture their email and email them a
 * link to open on desktop. The marketing site redirects mobile browsers here.
 */
export const mobileEmailSignupRoute = defineRoute({
  id: 'mobile-email-signup',
  path: 'mobile-email-signup',
  externalSearch: '*',
});

export const onboardingRoute = defineRoute({
  id: 'onboarding',
  path: 'onboarding',
  externalSearch: '*',
});

/** A personal GTM invite link (`?token=`): welcome page, then signup. */
export const inviteRoute = defineRoute({
  id: 'invite',
  path: 'invite',
  externalSearch: '*',
});

/** Macro staff only: create and track GTM invite links. */
export const internalInviteLinksRoute = defineRoute({
  id: 'internal-invite-links',
  path: 'internal/invite-links',
  externalSearch: '*',
});

export const teamInviteRoute = defineRoute({
  id: 'team-invite',
  path: 'team-invite',
  externalSearch: '*',
});

export const channelInviteRoute = defineRoute({
  id: 'channel-invite',
  path: 'channel-invite',
  externalSearch: '*',
});

/** The split layout; its children are the pane routes. */
export const appRoute = defineRoute({ id: APP_ROUTE_ID });

// Pane routes.

export const driveCallRoute = defineRoute({
  id: 'drive-call',
  path: 'call/:callId',
  params: z.object({ callId: z.string().min(1) }),
  search: [callDetailSearch.namespace],
  remountKey: ({ callId }) => callId,
  claim: ({ callId }) => ({ namespace: 'block', id: `call:${callId}` }),
  toReference: ({ callId }) => uuidRouteReference(callId, 'call'),
});

const driveDocumentParams = z.object({
  documentType: z.enum(DRIVE_DOCUMENT_TYPES),
  documentId: z.string().min(1),
});

const documentRemountKey = ({
  documentType,
  documentId,
}: z.infer<typeof driveDocumentParams>) =>
  `${driveDocumentBlockType(documentType)}:${documentId}`;

export const driveRootDocumentRoute = defineRoute({
  id: 'drive-document',
  search: [markdownDetailSearch.namespace, pdfDetailSearch.namespace],
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  state: driveDetailTrailSchema,
  remountKey: documentRemountKey,
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
  toReference: ({ documentId, documentType }) =>
    uuidRouteReference(documentId, documentType),
});

export const driveFolderDocumentRoute = defineRoute({
  id: 'drive-folder-document',
  search: [markdownDetailSearch.namespace, pdfDetailSearch.namespace],
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  state: driveDetailTrailSchema,
  remountKey: documentRemountKey,
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
  toReference: ({ documentId, documentType }) =>
    uuidRouteReference(documentId, documentType),
});

export const driveTabDocumentRoute = defineRoute({
  id: 'drive-tab-document',
  search: [markdownDetailSearch.namespace, pdfDetailSearch.namespace],
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  state: driveDetailTrailSchema,
  remountKey: documentRemountKey,
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
  toReference: ({ documentId, documentType }) =>
    uuidRouteReference(documentId, documentType),
});

export const driveFolderRoute = defineRoute({
  id: 'drive-folder',
  path: 'folder/:folderId?',
  params: z
    .object({ folderId: z.string().min(1).optional() })
    .transform(({ folderId }) => ({
      view: 'folder' as const,
      folderId,
    })),
  state: driveDetailTrailSchema,
});

export const driveTabRoute = defineRoute({
  id: 'drive-tab',
  path: ':tab',
  aliases: ['tab/:tab'],
  params: z.object({ tab: z.enum(['recent', 'shared']) }),
  state: driveDetailTrailSchema,
});

export const driveSplitRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  aliases: ['drive/owned', 'drive/tab/owned'],
  search: ['drive'],
  state: driveDetailTrailSchema,
  externalSearch: (entry: Readonly<Entry>) => {
    const type = routeParams(entry.location.route).documentType;
    if (
      type === 'md' ||
      type === 'task' ||
      type === 'snippet' ||
      type === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }
    if (type === 'pdf') return Object.values(PDF_URL_PARAMS);
    if (type === 'spreadsheet')
      return Object.values(SPREADSHEET_COMMENT_PARAMS);
    if (typeof routeParams(entry.location.route).callId === 'string')
      return [CALL_URL_PARAMS.transcriptId, CALL_URL_PARAMS.messageId];
    return [];
  },
});

export const settingsRoute = defineRoute({
  id: 'settings',
  path: 'settings/:tab?',
  params: z.object({
    tab: z
      .string()
      .refine((tab) => settingsSlugToTab(tab) !== undefined)
      .default(settingsTabToSlug('Account')),
  }),
  claim: () => ({ namespace: 'component', id: 'settings' }),
  externalSearch: ['pair', 'createAgent'],
});

export const agentsRoute = defineRoute({
  id: 'agents',
  path: 'agents/:id',
  params: z.object({ id: z.string() }),
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'agent', id }),
  search: [changesSearch.namespace, agentDetailSearch.namespace],
  toReference: ({ id }) => uuidRouteReference(id, 'agent'),
});

export const codersRoute = defineRoute({
  id: 'coders',
  path: 'coders/:id',
  params: z.object({ id: z.string() }),
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'agent', id }),
  search: [changesSearch.namespace, agentDetailSearch.namespace],
  toReference: ({ id }) => uuidRouteReference(id, 'agent'),
});

export const agentChatsRoute = defineRoute({
  id: 'agent-chats',
  path: 'agents/chat/:id',
  aliases: ['agent-chats/:id'],
  params: z.object({ id: z.string() }),
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'chat', id }),
  search: [changesSearch.namespace],
  toReference: ({ id }) => uuidRouteReference(id, 'chat'),
});

export const channelDetailRoute = defineRoute({
  id: 'channels-channel',
  path: ':channelId',
  params: z.object({ channelId: z.string().min(1) }),
  externalSearch: ['channel_message_id', 'channel_thread_id'],
  remountKey: ({ channelId }) => channelId,
  claim: ({ channelId }) => ({
    namespace: 'block',
    id: `channel:${channelId}`,
  }),
  toReference: ({ channelId }) => uuidRouteReference(channelId, 'channel'),
});

export const channelsSplitRoute = defineRoute({
  id: 'view-channels',
  path: 'channels',
  search: '*' as const,
});

/** The Calendar view inline in Home, at the Calendar route's own period path and search. */
export const homeCalendarRoute = defineRoute({
  id: 'home-calendar',
  path: 'calendar/:period',
  params: calendarPeriodParams,
  serializeParams: ({ period }) => ({ period: calendarPeriodPath(period) }),
  search: [CALENDAR_SEARCH_NAMESPACE],
});

export const homeChannelRoute = defineRoute({
  ...channelDetailRoute,
  id: 'home-channel',
  path: 'channel/:channelId',
});

export const homeDocumentRoute = defineRoute({
  ...driveRootDocumentRoute,
  id: 'home-document',
  externalSearch: (entry: Readonly<Entry>) => {
    const type = routeParams(entry.location.route).documentType;
    if (
      type === 'md' ||
      type === 'task' ||
      type === 'snippet' ||
      type === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }
    if (type === 'pdf') return Object.values(PDF_URL_PARAMS);
    return type === 'spreadsheet' ? [MARKDOWN_URL_PARAMS.commentId] : [];
  },
  remountKey: ({ documentType, documentId }) =>
    `${homeBaseBlockType(documentType)}:${documentId}`,
});

export const homePreviewRoute = defineRoute({
  id: 'home-preview',
  path: ':blockType/:previewId',
  params: homePreviewRouteParams,
  search: HOME_PREVIEW_SEARCH_NAMESPACES,
  // Blocks read their own location keys from the URL, as they do in Drive.
  externalSearch: (entry: Readonly<Entry>) => {
    const type = routeParams(entry.location.route).blockType;
    if (type === 'channel') return Object.values(CHANNEL_URL_PARAMS);
    if (type === 'email') return Object.values(EMAIL_URL_PARAMS);
    if (
      type === 'md' ||
      type === 'task' ||
      type === 'snippet' ||
      type === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }
    if (type === 'pdf') return Object.values(PDF_URL_PARAMS);
    return type === 'spreadsheet' ? [MARKDOWN_URL_PARAMS.commentId] : [];
  },
  remountKey: ({ blockType, previewId }) =>
    `${homeBaseBlockType(blockType)}:${previewId}`,
  claim: ({ blockType, previewId }) => ({
    namespace: blockType === 'agent' ? 'agent' : 'block',
    id:
      blockType === 'agent'
        ? previewId
        : `${homeBaseBlockType(blockType)}:${previewId}`,
  }),
  toReference: ({ previewId, blockType }) =>
    blockType === 'pr'
      ? { type: 'pr', id: previewId }
      : uuidRouteReference(previewId, blockType),
});

export const homeSplitRoute = defineRoute({
  id: 'view-home',
  path: 'home',
  search: '*' as const,
});

export const gettingStartedRoute = defineRoute({
  id: 'view-getting-started',
  path: 'getting-started',
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'getting-started' }),
});

export const recentRoute = defineRoute({
  id: 'view-recent',
  path: 'recent',
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'recent' }),
});

export const activityRoute = defineRoute({
  id: 'view-activity',
  path: 'activity',
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'activity' }),
});

export const routinesRoute = defineRoute({
  id: ROUTINES_ROUTE_ID,
  path: 'routines',
  claim: () => ({ namespace: 'component', id: 'routines' }),
});

export const routineCreateRoute = defineRoute({
  id: ROUTINE_CREATE_ROUTE_ID,
  path: 'routines/new',
  aliases: ['routine/new', 'automation/new'],
  claim: () => ({ namespace: 'component', id: 'routine-compose' }),
});

export const routineDetailRoute = defineRoute({
  id: ROUTINE_DETAIL_ROUTE_ID,
  path: 'routines/:routineId',
  aliases: ['routine/:routineId', 'automation/:routineId'],
  params: z.object({ routineId: z.string().min(1) }),
  remountKey: ({ routineId }) => routineId,
  claim: ({ routineId }) => ({ namespace: 'routine', id: routineId }),
  toReference: ({ routineId }) => uuidRouteReference(routineId, 'routine'),
});

export const agentsViewRoute = defineRoute({
  id: 'view-agents',
  path: 'agents',
  search: '*' as const,
  externalSearch: ['createAgent'],
  claim: () => ({ namespace: 'component', id: 'agents' }),
});

export const emailThreadRoute = defineRoute({
  id: 'mail-thread',
  path: ':threadId',
  params: z.object({ threadId: z.string().min(1) }),
  externalSearch: ['email_message_id'],
  remountKey: ({ threadId }) => threadId,
  claim: ({ threadId }) => ({
    namespace: 'block',
    id: `email:${threadId}`,
  }),
  toReference: ({ threadId }) => uuidRouteReference(threadId, 'email'),
});

export const emailSplitRoute = defineRoute({
  id: 'view-mail',
  path: 'mail',
  search: '*' as const,
});

export const taskDetailRoute = defineRoute({
  id: 'tasks-task',
  path: ':taskId',
  params: z.object({ taskId: z.string().min(1) }),
  remountKey: ({ taskId }) => taskId,
  claim: ({ taskId }) => ({
    namespace: 'block',
    id: `md:${taskId}`,
  }),
  toReference: ({ taskId }) => uuidRouteReference(taskId, 'task'),
  externalSearch: Object.values(MARKDOWN_URL_PARAMS),
});

export const projectTaskRoute = defineRoute({
  id: 'tasks-project-task',
  path: 'task/:taskId',
  params: z.object({ taskId: z.string().min(1) }),
  remountKey: ({ taskId }) => taskId,
  claim: ({ taskId }) => ({ namespace: 'block', id: `md:${taskId}` }),
  toReference: ({ taskId }) => uuidRouteReference(taskId, 'task'),
  externalSearch: Object.values(MARKDOWN_URL_PARAMS),
});

export const projectDetailRoute = defineRoute({
  id: 'tasks-project',
  path: 'projects/:projectId/:section',
  params: z.object({
    projectId: z.string().uuid(),
    section: z.enum(['overview', 'tasks']),
  }),
  remountKey: ({ projectId }) => projectId,
  claim: ({ projectId }) => ({
    namespace: 'block',
    id: `initiative:${projectId}`,
  }),
  toReference: ({ projectId }) => uuidRouteReference(projectId, 'initiative'),
});

export const tasksProjectsRoute = defineRoute({
  id: 'tasks-projects',
  path: 'projects',
  params: z.object({}).transform(() => ({ projectsTab: 'projects' as const })),
});

export const tasksSplitRoute = defineRoute({
  id: 'view-tasks',
  path: 'tasks',
  search: '*' as const,
});

export const reviewsPrRoute = defineRoute({
  id: 'reviews-pr',
  path: 'pr/:foreignEntityId',
  params: z.object({ foreignEntityId: z.string().min(1) }),
  remountKey: ({ foreignEntityId }) => foreignEntityId,
  claim: ({ foreignEntityId }) => ({
    namespace: 'block',
    id: `pr:${foreignEntityId}`,
  }),
  search: [changesSearch.namespace],
  toReference: ({ foreignEntityId }) => ({ type: 'pr', id: foreignEntityId }),
});

export const reviewsSplitRoute = defineRoute({
  id: 'view-reviews',
  path: 'reviews',
  search: [reviewsTabSearch.namespace],
});

export const calendarSplitRoute = defineRoute({
  id: CALENDAR_ROUTE_ID,
  path: 'calendar/:period',
  params: calendarPeriodParams,
  serializeParams: ({ period }) => ({
    period: calendarPeriodPath(period),
  }),
  search: [CALENDAR_SEARCH_NAMESPACE],
  externalSearch: ['eventId'],
  claim: () => ({ namespace: 'component', id: CALENDAR_VIEW_ID }),
});

export const callsRoute = defineRoute({
  id: 'view-calls',
  path: 'calls',
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'calls' }),
});

export const callDetailRoute = defineRoute({
  id: 'call-detail',
  path: 'call/:callId',
  params: z.object({ callId: z.string().min(1) }),
  search: [callDetailSearch.namespace],
  externalSearch: [CALL_URL_PARAMS.transcriptId, CALL_URL_PARAMS.messageId],
  remountKey: ({ callId }) => callId,
  claim: ({ callId }) => ({ namespace: 'block', id: `call:${callId}` }),
});

export const companiesRoute = defineRoute({
  id: 'view-companies',
  path: 'companies',
  search: '*' as const,
  externalSearch: ['crmView'],
  claim: () => ({ namespace: 'component', id: 'companies' }),
});

export const foldersRoute = defineRoute({
  id: 'view-folders',
  path: 'folders',
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'folders' }),
});

export const searchRoute = defineRoute({
  id: 'view-search',
  path: 'search',
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'search' }),
});

export const prDetailRoute = defineRoute({
  id: 'pr-detail',
  path: 'pr/:foreignEntityId',
  params: z.object({ foreignEntityId: z.string().min(1) }),
  remountKey: ({ foreignEntityId }) => foreignEntityId,
  claim: ({ foreignEntityId }) => ({
    namespace: 'block',
    id: `pr:${foreignEntityId}`,
  }),
  search: [changesSearch.namespace],
});

const debugComponentIds = [
  'ui',
  'icon-gallery',
  ...(LOCAL_ONLY
    ? [
        'theme-edit-3',
        'theme-debug',
        'core',
        'md',
        'data',
        'chat',
        'chat-attachment',
        'chat-tool',
        'http-stream',
        'static-markdown-stream',
        'resize',
        'notifications-playground',
        'props-debug',
        'entity-debug',
        'quick-access-list',
        'hotkey-debugger',
        'user-icon',
        'dynamic-ui',
        'agent-ui',
        'agent-replay',
        'agent-changes-ui',
        'diff-view-ui',
      ]
    : []),
  ...(import.meta.env.DEV ? ['spreadsheet-demo'] : []),
  ...(DEV_MODE_ENV
    ? [
        'document-where-playground',
        'projection-playground',
        'md-parse',
        'md-builder',
        'collab-surface-demo',
      ]
    : []),
];

/** Registered debug views, behind their environment gates. */
export const debugRoutes = debugComponentIds.map((componentId) => ({
  componentId,
  route: defineRoute({
    id: `view-${componentId}`,
    path: `debug/${componentId}`,
    aliases: [`component/${componentId}`],
    search: '*' as const,
    externalSearch: componentId === 'ui' ? ['ui'] : [],
    claim: () => ({ namespace: 'component', id: componentId }),
  }),
}));

/** Pre-router `type/id` URLs; the middleware upgrades the ones that have a route now. */
export const legacyContentRoute = defineRoute({
  id: 'legacy-content',
  path: ':type/:id',
  search: '*',
  params: z
    .object({ type: z.string().min(1), id: z.string().min(1) })
    .refine(({ type, id }) => decodeLegacyPair(type, id) !== undefined),
  externalSearch: (entry) => {
    const { type } = routeParams(entry.location.route);
    if (type === 'email') return Object.values(EMAIL_URL_PARAMS);
    if (type === 'channel') return Object.values(CHANNEL_URL_PARAMS);
    if (type === 'company' || type === 'contact') return [COMMENT_LINK_PARAM];
    return [];
  },
  claim: ({ type, id }) => {
    const content = decodeLegacyPair(type, id);
    if (!content) return;

    if (content.type === 'agent') return { namespace: 'agent', id };

    if (content.type === 'component') {
      const [section, conversationId] = agentsRouteSegments(content.id) ?? [];
      if (section && conversationId) {
        return {
          namespace: section === 'agent-chats' ? 'chat' : 'agent',
          id: conversationId,
        };
      }
      return { namespace: 'component', id: content.id };
    }

    return {
      namespace: 'block',
      id: `${content.aliasContext?.baseType ?? content.type}:${id}`,
    };
  },
});

/** Catches any pane path no other route matches; listed last. */
export const notFoundRoute = defineRoute({
  id: NOT_FOUND_ROUTE_ID,
  path: '*segments',
});
