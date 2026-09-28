import type { SplitRouter, SplitRoutesManifest } from '@app/lib/split-router';
import { encodeRoute } from '@app/lib/split-router/routes';
import { replaceSplitSearchParams } from '@app/lib/split-router/search';
import type {
  OpenWithSplitOptions,
  SplitContent,
  SplitId,
  SplitManager,
} from '../layoutManager';
import { openAppSplitLocation } from '../splitRouterLayout';
import { resolveContentLocation } from './legacy-route';

export function createContentNavigator(
  manager: SplitManager,
  router: SplitRouter<SplitId>,
  routes: SplitRoutesManifest
) {
  return (content: SplitContent, options: OpenWithSplitOptions) => {
    const firstVisible = manager.getVisibleSplits()[0];
    const source =
      options.handle ??
      manager.activeSplit() ??
      (firstVisible ? manager.getSplit(firstVisible.id) : undefined);
    if (!source) return;
    const location = resolveContentLocation(routes, content);
    const path = `/${encodeRoute(routes, { location }).map(encodeURIComponent).join('/')}`;
    const query = new URLSearchParams();
    replaceSplitSearchParams(query, [{ location }]);
    router.navigate(source.id, query.size ? `${path}?${query}` : path, {
      target:
        options.preferNewSplit && manager.canAppendSplit()
          ? 'new-split'
          : 'current',
      replace: options.mergeHistory,
      search: options.search,
      open: (request) =>
        openAppSplitLocation(manager, routes, request, content, options),
    });
  };
}
