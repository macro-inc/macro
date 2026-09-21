import { LIST_VIEW_ID } from '@app/constants/list-views';
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
import { lazy } from 'solid-js';
import { z } from 'zod';
import { handleLegacySplitPath, legacySplitRoute } from './legacy-route';

const agentParams = z.object({ id: z.string() });

const agentsSplitRoutes = ['agents', 'coders', 'agent-chats'].map((section) =>
  defineRoute({
    id: section,
    path: `${section}/:id`,
    params: agentParams,
    claim: ({ id }) => ({
      namespace: section === 'agent-chats' ? 'chat' : 'agent',
      id,
    }),
  })
);

const settingsParams = z.object({
  tab: z
    .string()
    .refine((tab) => settingsSlugToTab(tab) !== undefined)
    .default(settingsTabToSlug('Account')),
});

const settingsSplitRoute = defineRoute({
  id: 'settings',
  path: 'settings/:tab?',
  params: settingsParams,
  claim: () => ({ namespace: 'component', id: 'settings' }),
  externalSearch: ['pair', 'createAgent'],
});

const DriveRouteView = lazy(async () => {
  const module = await import('@app/features/drive-view/drive-route-view');

  return { default: module.DriveRouteView };
});

const DriveDetailRouteView = lazy(async () => {
  const module = await import('@app/features/drive-view/drive-route-view');

  return { default: module.DriveDetailRouteView };
});

function withDriveRouteComponents(
  route: SplitRouteDefinition
): SplitRouteDefinition {
  return {
    ...route,
    component:
      route.id === 'drive'
        ? DriveRouteView
        : route.id.endsWith('-document')
          ? DriveDetailRouteView
          : route.component,
    children: route.children?.flatMap((child) =>
      child ? [withDriveRouteComponents(child)] : []
    ),
  };
}

const driveRoute = withDriveRouteComponents(driveSplitRoute);

export const appSplitRoutes: SplitRoutes = {
  definitions: [
    driveRoute,
    settingsSplitRoute,
    ...agentsSplitRoutes,
    legacySplitRoute,
  ],
  globalSearch: ['referral_code'],
  unmatchedPathHandlers: [handleLegacySplitPath],
  defaultEntry: () => ({
    location: {
      route: {
        matches: [
          {
            id: 'legacy-content',
            params: { type: 'component', id: LIST_VIEW_ID.inbox },
          },
        ],
      },
    },
  }),
};
