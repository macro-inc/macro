import { AgentsRouteView } from '@app/features/agents-view/route';
import { defineRoute } from '@app/lib/split-router';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { uuidRouteReference } from '@components/app/split-layout/split-router/mention-links';
import { onMount } from 'solid-js';
import { z } from 'zod';
import {
  ROUTINE_CREATE_ROUTE_ID,
  ROUTINE_DETAIL_ROUTE_ID,
  ROUTINES_ROUTE_ID,
  routineContent,
} from './routine-navigation';

const RoutineCreateRouteView = withAuth(() => {
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

export const routinesRoute = defineRoute({
  id: ROUTINES_ROUTE_ID,
  path: 'routines',
  component: AgentsRouteView,
  claim: () => ({ namespace: 'component', id: 'routines' }),
});

export const routineCreateRoute = defineRoute({
  id: ROUTINE_CREATE_ROUTE_ID,
  path: 'routines/new',
  aliases: ['routine/new', 'automation/new'],
  component: RoutineCreateRouteView,
  claim: () => ({ namespace: 'component', id: 'routine-compose' }),
});

export const routineDetailRoute = defineRoute({
  id: ROUTINE_DETAIL_ROUTE_ID,
  path: 'routines/:routineId',
  aliases: ['routine/:routineId', 'automation/:routineId'],
  params: z.object({ routineId: z.string().min(1) }),
  component: AgentsRouteView,
  remountKey: ({ routineId }) => routineId,
  claim: ({ routineId }) => ({ namespace: 'routine', id: routineId }),
  toReference: ({ routineId }) => uuidRouteReference(routineId, 'routine'),
});
