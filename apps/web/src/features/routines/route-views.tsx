import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { onMount } from 'solid-js';
import { routineContent } from './routine-navigation';

export const RoutineCreateRouteView = withAuth(() => {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  onMount(() => {
    layout.openWithSplit(routineContent(), {
      handle: panel.handle,
      mergeHistory: true,
      search: {},
    });
    layout.popoverSplit({ type: 'component', id: 'routine-compose' });
  });
  return null;
});
