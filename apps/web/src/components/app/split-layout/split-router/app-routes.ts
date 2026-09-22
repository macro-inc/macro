import {
  DRIVE_DOCUMENT_TYPES,
  driveDocumentBlockType,
} from '@app/features/drive-view/primitives/drive-route-schema';
import { inboxPreviewRouteParams } from '@app/features/inbox-view/inbox-route-schema';
import {
  defineRoute,
  defineRoutes,
  routeParams,
  type SplitRouterEntry,
} from '@app/lib/split-router';
import { URL_PARAMS as MARKDOWN_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import {
  settingsSlugToTab,
  settingsTabToSlug,
} from '@core/constant/settingsTabsConfig';
import { type Component, createComponent, lazy } from 'solid-js';
import { z } from 'zod';
import type { AppRouteViewId } from './app-views';
import { handleLegacySplitPath, legacySplitRoute } from './legacy-route';

const AppRouteRenderer = lazy(async () => ({
  default: (await import('./app-views')).AppRouteRenderer,
}));

/** Stable route bindings share one lazy application-view module boundary. */
function appView(view: AppRouteViewId): Component {
  return () => createComponent(AppRouteRenderer, { view });
}

function viewDefinition<const TId extends string>(
  id: TId,
  view: AppRouteViewId,
  externalSearch: string[] = []
) {
  return defineRoute({
    id: `view-${id}`,
    path: id,
    component: appView(view),
    search: '*' as const,
    externalSearch,
    claim: () => ({ namespace: 'component', id }),
  });
}

const driveDocumentParams = z.object({
  documentType: z.enum(DRIVE_DOCUMENT_TYPES),
  documentId: z.string().min(1),
});
export const driveRootDocumentRoute = defineRoute({
  id: 'drive-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  component: appView('drive-detail'),
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
});
export const driveFolderDocumentRoute = defineRoute({
  id: 'drive-folder-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  component: appView('drive-detail'),
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
});
export const driveTabDocumentRoute = defineRoute({
  id: 'drive-tab-document',
  path: ':documentType/:documentId',
  params: driveDocumentParams,
  component: appView('drive-detail'),
  claim: ({ documentType, documentId }) => ({
    namespace: 'block',
    id: `${driveDocumentBlockType(documentType)}:${documentId}`,
  }),
});
export const driveFolderRoute = defineRoute({
  id: 'drive-folder',
  path: 'folder/:folderId?',
  params: z
    .object({ folderId: z.string().min(1).optional() })
    .transform(({ folderId }) => ({ view: 'folder' as const, folderId })),
  children: [driveFolderDocumentRoute],
});
export const driveTabRoute = defineRoute({
  id: 'drive-tab',
  path: ':tab',
  aliases: ['tab/:tab'],
  params: z.object({ tab: z.enum(['recent', 'shared']) }),
  children: [driveTabDocumentRoute],
});
export const driveSplitRoute = defineRoute({
  id: 'drive',
  path: 'drive',
  aliases: ['drive/owned', 'drive/tab/owned'],
  params: z.object({}),
  component: appView('drive'),
  search: ['drive'],
  externalSearch: (entry: Readonly<SplitRouterEntry>) => {
    const type = routeParams<{ documentType?: string }>(
      entry.location.route
    ).documentType;
    if (
      type === 'md' ||
      type === 'task' ||
      type === 'snippet' ||
      type === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }
    return type === 'pdf' ? Object.values(PDF_URL_PARAMS) : [];
  },
  children: [driveFolderRoute, driveTabRoute, driveRootDocumentRoute],
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
  component: appView('settings'),
  claim: () => ({ namespace: 'component', id: 'settings' }),
  externalSearch: ['pair', 'createAgent'],
});

export const agentsRoute = defineRoute({
  id: 'agents',
  path: 'agents/:id',
  params: z.object({ id: z.string() }),
  component: appView('agents'),
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'agent', id }),
});
export const codersRoute = defineRoute({
  id: 'coders',
  path: 'coders/:id',
  params: z.object({ id: z.string() }),
  component: appView('agents'),
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'agent', id }),
});
export const agentChatsRoute = defineRoute({
  id: 'agent-chats',
  path: 'agents/chat/:id',
  aliases: ['agent-chats/:id'],
  params: z.object({ id: z.string() }),
  component: appView('agents'),
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'chat', id }),
});

export const homeRoute = viewDefinition('home', 'home');
export const gettingStartedRoute = viewDefinition(
  'getting-started',
  'getting-started'
);

export const inboxPreviewRoute = defineRoute({
  id: 'inbox-preview',
  path: ':blockType/:previewId',
  params: inboxPreviewRouteParams,
  component: appView('inbox-detail'),
  remountKey: ({ blockType, previewId }) => `${blockType}:${previewId}`,
  claim: ({ blockType, previewId }) => ({
    namespace: 'block',
    id: `${blockType}:${previewId}`,
  }),
});
export const inboxSplitRoute = defineRoute({
  id: 'view-inbox',
  path: 'inbox',
  params: z.object({}),
  component: appView('inbox'),
  search: '*' as const,
  children: [inboxPreviewRoute],
});

export const recentRoute = viewDefinition('recent', 'recent');
export const activityRoute = viewDefinition('activity', 'activity');
export const remindersRoute = viewDefinition('reminders', 'reminders');
export const agentsViewRoute = viewDefinition('agents', 'agents', [
  'createAgent',
]);

export const emailThreadRoute = defineRoute({
  id: 'mail-thread',
  path: ':threadId',
  params: z.object({ threadId: z.string().min(1) }),
  component: appView('mail-detail'),
  externalSearch: ['email_message_id'],
  remountKey: ({ threadId }) => threadId,
  claim: ({ threadId }) => ({
    namespace: 'block',
    id: `email:${threadId}`,
  }),
});
export const emailSplitRoute = defineRoute({
  id: 'view-mail',
  path: 'mail',
  params: z.object({}),
  component: appView('mail'),
  search: '*' as const,
  children: [emailThreadRoute],
});

export const taskDetailRoute = defineRoute({
  id: 'tasks-task',
  path: ':taskId',
  params: z.object({ taskId: z.string().min(1) }),
  component: appView('tasks-detail'),
  remountKey: ({ taskId }) => taskId,
  claim: ({ taskId }) => ({
    namespace: 'block',
    id: `md:${taskId}`,
  }),
});
export const tasksSplitRoute = defineRoute({
  id: 'view-tasks',
  path: 'tasks',
  params: z.object({}),
  component: appView('tasks'),
  search: '*' as const,
  children: [taskDetailRoute],
});

export const channelDetailRoute = defineRoute({
  id: 'channels-channel',
  path: 'channel/:channelId',
  params: z.object({ channelId: z.string().min(1) }),
  component: appView('channels-detail'),
  externalSearch: ['channel_message_id', 'channel_thread_id'],
  remountKey: ({ channelId }) => channelId,
  claim: ({ channelId }) => ({
    namespace: 'block',
    id: `channel:${channelId}`,
  }),
});
export const channelsSplitRoute = defineRoute({
  id: 'view-channels',
  path: 'channels',
  params: z.object({}),
  component: appView('channels'),
  search: '*' as const,
  children: [channelDetailRoute],
});

export const callsRoute = viewDefinition('calls', 'calls');
export const companiesRoute = viewDefinition('companies', 'companies', [
  'crmView',
]);
export const foldersRoute = viewDefinition('folders', 'folders');
export const searchRoute = viewDefinition('search', 'search');

export const appSplitRoutes = defineRoutes({
  definitions: [
    driveSplitRoute,
    settingsRoute,
    agentsRoute,
    codersRoute,
    agentChatsRoute,
    homeRoute,
    gettingStartedRoute,
    inboxSplitRoute,
    recentRoute,
    activityRoute,
    remindersRoute,
    agentsViewRoute,
    emailSplitRoute,
    tasksSplitRoute,
    channelsSplitRoute,
    callsRoute,
    companiesRoute,
    foldersRoute,
    searchRoute,
    legacySplitRoute,
  ],
  globalSearch: ['referral_code'],
  unmatchedPathHandlers: [handleLegacySplitPath],
  defaultEntry: () => ({
    location: { route: { matches: [{ id: 'view-inbox', params: {} }] } },
  }),
});
