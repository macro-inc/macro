import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import {
  createRoutesManifest,
  decodeSplitRouterLocation,
  rootRouteMatch,
  routeParams,
  serializeSplitRouterLocation,
} from '@app/lib/split-router';
import { appSplitRoutes } from '@components/app/split-layout/split-router/app-routes';

export const settingsTabSlugFromUrl = (
  urlString: string
): string | undefined => {
  // Standalone URL operations can run before a router exists; keep state local.
  const routes = createRoutesManifest(appSplitRoutes);
  const entry = decodeSplitRouterLocation({
    routes,
    location: urlString,
  }).entries.find(
    ({ location }) => rootRouteMatch(location.route)?.id === 'settings'
  );

  const tab = routeParams(entry?.location.route).tab;
  return typeof tab === 'string' ? tab : undefined;
};

/**
 * Drop a settings split from a base-relative split-layout URL, if present.
 * Handles both the URL encoding (`settings/<tab>`) and the legacy internal
 * form (`component/settings`). Only type positions (even indices) are
 * inspected so a block id that happens to be "settings" isn't mistaken for
 * one.
 *
 * The owned query string and hash are preserved. When settings was the only
 * split there is no layout left to return to, so the default route is returned.
 */
export const stripSettingsSplitFromUrl = (urlString: string): string => {
  const routes = createRoutesManifest(appSplitRoutes);
  const parsed = decodeSplitRouterLocation({
    routes,
    location: urlString,
  });
  const entries = [...parsed.entries];
  const removedSplitIndex = entries.findIndex(
    ({ location }) => rootRouteMatch(location.route)?.id === 'settings'
  );
  if (removedSplitIndex >= 0) entries.splice(removedSplitIndex, 1);

  if (entries.length === 0) return DEFAULT_ROUTE;

  return serializeSplitRouterLocation({
    routes,
    entries,
    previous: parsed.externalLocation,
    preserveHash: true,
  });
};

/**
 * Append a docked settings split (`settings/<slug>`) to a base-relative
 * split-layout URL, keeping its owned query string and hash.
 */
export const appendSettingsSplitToUrl = (
  urlString: string,
  settingsTabSlug: string
): string => {
  const routes = createRoutesManifest(appSplitRoutes);
  const parsed = decodeSplitRouterLocation({
    routes,
    location: urlString,
  });
  return serializeSplitRouterLocation({
    routes,
    entries: [
      ...parsed.entries,
      {
        location: {
          route: {
            matches: [
              {
                id: 'settings',
                params: { tab: settingsTabSlug },
              },
            ],
          },
        },
      },
    ],
    previous: parsed.externalLocation,
    preserveHash: true,
  });
};
