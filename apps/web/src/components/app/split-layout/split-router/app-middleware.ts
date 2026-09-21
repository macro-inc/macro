import {
  driveDocumentFromContent,
  drivePath,
} from '@app/features/drive-view/primitives/drive-route';
import { routeParams, type SplitRouterMiddleware } from '@app/lib/split-router';
import { decodeLegacyPair } from './legacy-route';

export const appSplitRouterMiddleware = [
  ({ to, redirect }) => {
    const params = routeParams(to.location.route);
    const type = typeof params.type === 'string' ? params.type : undefined;
    const id = typeof params.id === 'string' ? params.id : undefined;
    const content = type && id ? decodeLegacyPair(type, id) : undefined;
    const document = content && driveDocumentFromContent(content);
    if (!document) return;

    return redirect(drivePath({ kind: 'tab', tab: 'owned' }, document));
  },
] satisfies readonly SplitRouterMiddleware[];
