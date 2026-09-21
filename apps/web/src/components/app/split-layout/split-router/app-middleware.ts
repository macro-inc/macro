import {
  driveDocumentFromContent,
  drivePath,
} from '@app/features/drive-view/primitives/drive-route';
import { routeParams, type SplitRouterMiddleware } from '@app/lib/split-router';
import { appSplitRoutes } from './app-routes';
import { decodeLegacyPair } from './legacy-route';

export const appSplitRouterMiddleware = [
  ({ to, redirect }) => {
    if (to.location.route.matches[0].id !== 'legacy-content') return;
    const params = routeParams(to.location.route);
    const type = typeof params.type === 'string' ? params.type : undefined;
    const id = typeof params.id === 'string' ? params.id : undefined;
    if (type === 'component' && id) {
      if (id === 'preview-empty' || id === 'non-member-channel')
        return redirect('/inbox');
      if (id === 'documents') return redirect('/drive');
      if (id === 'settings') return redirect('/settings');
      if (
        appSplitRoutes.definitions.some((route) => route.id === `view-${id}`)
      ) {
        return redirect(`/${id}`);
      }
    }
    const content = type && id ? decodeLegacyPair(type, id) : undefined;
    const document = content && driveDocumentFromContent(content);
    if (!document) return;

    return redirect(drivePath({ kind: 'tab', tab: 'owned' }, document));
  },
] satisfies readonly SplitRouterMiddleware[];
