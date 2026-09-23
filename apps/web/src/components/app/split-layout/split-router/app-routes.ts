import { driveSplitRoute } from '@app/features/drive-view/primitives/drive-route';
import {
  defineRoute,
  type SplitRouteDefinition,
  type SplitRoutes,
} from '@app/lib/split-router';
import {
  settingsSlugToTab,
  settingsTabToSlug,
} from '@core/constant/settingsTabsConfig';
import { type Component, lazy } from 'solid-js';
import { z } from 'zod';
import type * as AppViews from './app-views';
import { handleLegacySplitPath, legacySplitRoute } from './legacy-route';

type AppViewSelector = (
  views: typeof AppViews
) => Component<Record<string, unknown>>;

// URL parsing must not initialize the application views and their dependencies.
function lazyView(select: AppViewSelector) {
  return lazy(async () => {
    const views = await import('./app-views');
    return { default: views.withLaunchParams(() => select(views)) };
  });
}

function viewRoute(
  id: string,
  view: AppViewSelector,
  externalSearch: string[] = []
) {
  return defineRoute({
    id: `view-${id}`,
    path: id,
    component: lazyView(view),
    search: '*',
    externalSearch,
    claim: () => ({ namespace: 'component', id }),
  });
}

const agentsSplitRoutes = ['agents', 'coders', 'agent-chats'].map((section) =>
  defineRoute({
    id: section,
    path: section === 'agent-chats' ? 'agents/chat/:id' : `${section}/:id`,
    aliases: section === 'agent-chats' ? ['agent-chats/:id'] : undefined,
    params: z.object({ id: z.string() }),
    component: lazyView((views) => views.AgentsRouteView),
    remountKey: ({ id }: Record<string, unknown>) => String(id),
    claim: ({ id }) => ({
      namespace: section === 'agent-chats' ? 'chat' : 'agent',
      id,
    }),
  })
);

const settingsSplitRoute = defineRoute({
  id: 'settings',
  path: 'settings/:tab?',
  params: z.object({
    tab: z
      .string()
      .refine((tab) => settingsSlugToTab(tab) !== undefined)
      .default(settingsTabToSlug('Account')),
  }),
  component: lazyView((views) => views.SettingsView),
  claim: () => ({ namespace: 'component', id: 'settings' }),
  externalSearch: ['pair', 'createAgent'],
});

const DriveView = lazyView((views) => views.DriveRouteView);
const DriveDetailView = lazy(async () => ({
  default: (await import('@app/features/drive-view/components/DriveDetailView'))
    .DriveDetailView,
}));

function withDriveComponents(
  route: SplitRouteDefinition
): SplitRouteDefinition {
  return {
    ...route,
    component:
      route.id === 'drive'
        ? DriveView
        : route.id.endsWith('-document')
          ? DriveDetailView
          : route.component,
    children: route.children?.flatMap((child) =>
      child ? [withDriveComponents(child)] : []
    ),
  };
}

export const appSplitRoutes: SplitRoutes = {
  definitions: [
    withDriveComponents(driveSplitRoute),
    settingsSplitRoute,
    ...agentsSplitRoutes,
    viewRoute('home', (views) => views.HomeView),
    viewRoute('getting-started', (views) => views.GettingStartedView),
    viewRoute('inbox', (views) => views.InboxRouteView),
    viewRoute('recent', (views) => views.RecentView),
    viewRoute('activity', (views) => views.ActivityView),
    viewRoute('reminders', (views) => views.RemindersView),
    viewRoute('agents', (views) => views.AgentsRouteView, ['createAgent']),
    viewRoute('mail', (views) => views.MailView),
    viewRoute('tasks', (views) => views.TasksRouteView),
    viewRoute('channels', (views) => views.ChannelsRouteView),
    viewRoute('calls', (views) => views.CallsView),
    viewRoute('companies', (views) => views.CompaniesView, ['crmView']),
    viewRoute('folders', (views) => views.FoldersView),
    viewRoute('search', (views) => views.SearchView),
    legacySplitRoute,
  ],
  globalSearch: ['referral_code'],
  unmatchedPathHandlers: [handleLegacySplitPath],
  defaultEntry: () => ({
    location: { route: { matches: [{ id: 'view-inbox', params: {} }] } },
  }),
};
