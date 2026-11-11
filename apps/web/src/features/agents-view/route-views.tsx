import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { lazy, Show } from 'solid-js';
import { AgentsViewSkeleton } from './agents-view-skeleton';
import { parseAgentsRoute } from './core/route';

const AgentsView = lazy(async () => ({
  default: (await import('./views/AgentsView')).AgentsView,
}));

export const AgentsRouteView = withAuth(() => {
  const panel = useSplitPanelOrThrow();
  useViewRestoration();
  const route = () => {
    const content = panel.handle.content();
    if (content.type === 'component' && content.id === 'routines') return;
    const requested =
      content.type === 'component' &&
      typeof content.params?.agentsRoute === 'string'
        ? content.params.agentsRoute
        : content.id;
    return parseAgentsRoute(requested);
  };
  usePageViewTracking('agents');
  return (
    <Show
      when={isTouchDevice() && route()}
      fallback={<AgentsView route={route()} />}
    >
      {(current) => (
        <RedirectSplit
          mergeHistory
          to={{
            type:
              current().conversation.type === 'agent_session'
                ? 'agent'
                : 'chat',
            id: current().conversation.id,
          }}
        />
      )}
    </Show>
  );
}, AgentsViewSkeleton);
