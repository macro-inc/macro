import { createRoutesManifest } from '@app/lib/split-router';
import { routeDefinitions } from '@app/lib/split-router/solid/route';
import { appRouteElements } from '@app/routes/app-router-view';
import { createRoot } from 'solid-js';

/** The app's real route table, as the router compiles it. */
export function appRoutesManifest() {
  return createRoot((dispose) => {
    const definitions = routeDefinitions(appRouteElements());
    dispose();

    return createRoutesManifest({
      definitions,
      defaultRoute: () => ({ matches: [{ id: 'base', params: {} }] }),
    });
  });
}
