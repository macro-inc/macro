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
import * as views from './app-views';
import { handleLegacySplitPath, legacySplitRoute } from './legacy-route';

function viewRoute(
  id: string,
  view: () => Component<Record<string, unknown>>,
  externalSearch: string[] = []
) {
  return defineRoute({
    id: `view-${id}`,
    path: id,
    component: views.withLaunchParams(view),
    search: '*',
    externalSearch,
    claim: () => ({ namespace: 'component', id }),
  });
}

const agentsSplitRoutes = ['agents', 'coders', 'agent-chats'].map((section) =>
  defineRoute({
    id: section,
    path: `${section}/:id`,
    params: z.object({ id: z.string() }),
    component: views.withLaunchParams(() => views.AgentsRouteView),
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
  component: views.withLaunchParams(() => views.SettingsView),
  claim: () => ({ namespace: 'component', id: 'settings' }),
  externalSearch: ['pair', 'createAgent'],
});

const DriveView = views.withLaunchParams(() => views.DriveRouteView);
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
    viewRoute('home', () => views.HomeView),
    viewRoute('getting-started', () => views.GettingStartedView),
    viewRoute('inbox', () => views.InboxRouteView),
    viewRoute('recent', () => views.RecentView),
    viewRoute('activity', () => views.ActivityView),
    viewRoute('reminders', () => views.RemindersView),
    viewRoute('agents', () => views.AgentsRouteView, ['createAgent']),
    viewRoute('mail', () => views.MailView),
    viewRoute('tasks', () => views.TasksRouteView),
    viewRoute('channels', () => views.ChannelsRouteView),
    viewRoute('calls', () => views.CallsView),
    viewRoute('companies', () => views.CompaniesView, ['crmView']),
    viewRoute('folders', () => views.FoldersView),
    viewRoute('search', () => views.SearchView),
    legacySplitRoute,
  ],
  globalSearch: ['referral_code'],
  unmatchedPathHandlers: [handleLegacySplitPath],
  defaultEntry: () => ({
    location: { route: { matches: [{ id: 'view-inbox', params: {} }] } },
  }),
};
