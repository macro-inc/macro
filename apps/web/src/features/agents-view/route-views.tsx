import { useRoutineEntities } from '@app/features/routines/queries/entities';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createRenderEffect, lazy, Show } from 'solid-js';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import { routineContent } from '../routines/routine-navigation';
import { parseAgentsRoute } from './core/route';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));
const AgentsView = lazy(async () => ({
  default: (await import('./views/AgentsView')).AgentsView,
}));
const RoutinesPage = lazy(async () => ({
  default: (await import('../routines/routines-page')).RoutinesPage,
}));
const McpConnections = lazy(async () => ({
  default: (await import('../settings/McpConnections')).McpConnections,
}));

function LegacyAgentsView() {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const user = useUserContext();
  const preset = getViewPreset('agents', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  const entities = useRoutineEntities();
  return (
    <div class="flex size-full flex-col touch:pt-(--mobile-content-inset-top)">
      <div
        class="flex gap-1 border-b border-edge-muted px-4 py-2"
        role="group"
        aria-label="Agent workspace"
      >
        <button
          type="button"
          aria-pressed={true}
          class="rounded-md px-3 py-1.5 text-sm text-ink hover:bg-hover"
        >
          Agents
        </button>
        <button
          type="button"
          aria-pressed={false}
          class="rounded-md px-3 py-1.5 text-sm text-ink hover:bg-hover"
          onClick={() =>
            layout.openWithSplit(routineContent(), {
              handle: panel.handle,
              activate: true,
              search: {},
            })
          }
        >
          Routines
        </button>
      </div>
      <div
        class="min-h-0 flex-1 overflow-auto"
        style={{ '--mobile-content-inset-top': '0px' }}
      >
        <SoupView
          viewName="Agents"
          initialFilters={preset?.filters}
          initialClientFilters={preset?.clientFilters}
          initialGroupBy={preset?.groupBy}
          additionalEntities={entities}
        />
      </div>
    </div>
  );
}

export const AgentsRouteView = withAuth(() => {
  const panel = useSplitPanelOrThrow();
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
  const flag = useFeatureFlag(enableChatV3Agents);
  const enabled = () => flag().enabled;
  createRenderEffect(() => {
    if (flag().loading) return;
    panel.handle.updateMeta?.({
      splitPanelLayout: enabled() ? 'composable' : 'legacy',
    });
  });
  const connectionsRequested = () => {
    const content = panel.handle.content();
    return (
      content.type === 'component' &&
      content.id !== 'routines' &&
      content.params?.agentPage === 'connections'
    );
  };
  return (
    <Show when={!flag().loading} fallback={<LoadingBlock />}>
      <Show
        when={enabled()}
        fallback={
          <Show
            when={connectionsRequested()}
            fallback={
              <Show
                when={route()}
                fallback={
                  <Show
                    when={(() => {
                      const content = panel.handle.content();
                      return (
                        content.type === 'component' &&
                        (content.id === 'routines' ||
                          content.params?.agentPage === 'routines')
                      );
                    })()}
                    fallback={<LegacyAgentsView />}
                  >
                    <div class="size-full overflow-hidden">
                      <RoutinesPage />
                    </div>
                  </Show>
                }
              >
                {(current) => (
                  <RedirectSplit
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
            }
          >
            <McpConnections />
          </Show>
        }
      >
        <Show
          when={isTouchDevice() && route()}
          fallback={<AgentsView initialRoute={route()} />}
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
      </Show>
    </Show>
  );
});
