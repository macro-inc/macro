import { changesSearch } from '@app/features/agent-changes/changes-search';
import { agentDetailSearch } from '@app/features/block-agent/agent-route';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { defineRoute } from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { uuidRouteReference } from '@components/app/split-layout/split-router/mention-links';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import { createRenderEffect, createSignal, lazy, Show } from 'solid-js';
import { z } from 'zod';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
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
  const [routines, setRoutines] = createSignal(false);
  const user = useUserContext();
  const preset = getViewPreset('agents', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  const entities = useAutomationEntities();
  return (
    <div class="flex size-full flex-col touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
      <div
        class="flex gap-1 border-b border-edge-muted px-4 py-2"
        role="group"
        aria-label="Agent workspace"
      >
        <button
          type="button"
          aria-pressed={!routines()}
          class="rounded-md px-3 py-1.5 text-sm text-ink hover:bg-hover"
          onClick={() => setRoutines(false)}
        >
          Agents
        </button>
        <button
          type="button"
          aria-pressed={routines()}
          class="rounded-md px-3 py-1.5 text-sm text-ink hover:bg-hover"
          onClick={() => setRoutines(true)}
        >
          Routines
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <Show
          when={routines()}
          fallback={
            <SoupView
              viewName="Agents"
              initialFilters={preset?.filters}
              initialClientFilters={preset?.clientFilters}
              initialGroupBy={preset?.groupBy}
              additionalEntities={entities}
            />
          }
        >
          <RoutinesPage />
        </Show>
      </div>
    </div>
  );
}

export const AgentsRouteView = withAuth(() => {
  const panel = useSplitPanelOrThrow();
  const route = () => {
    const content = panel.handle.content();
    const requested =
      content.type === 'component' &&
      typeof content.params?.agentsRoute === 'string'
        ? content.params.agentsRoute
        : content.id;
    return parseAgentsRoute(requested);
  };
  usePageViewTracking('agents');
  const flag = useFeatureFlag(enableChatV3Agents);
  const enabled = () => flag().enabled && !isTouchDevice();
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
                        content.params?.agentPage === 'routines'
                      );
                    })()}
                    fallback={<LegacyAgentsView />}
                  >
                    <div class="size-full overflow-auto touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
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
        <AgentsView initialRoute={route()} />
      </Show>
    </Show>
  );
});

export const agentsRoute = defineRoute({
  id: 'agents',
  path: 'agents/:id',
  params: z.object({ id: z.string() }),
  component: AgentsRouteView,
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'agent', id }),
  search: [changesSearch.namespace, agentDetailSearch.namespace],
  toReference: ({ id }) => uuidRouteReference(id, 'agent'),
});

export const codersRoute = defineRoute({
  id: 'coders',
  path: 'coders/:id',
  params: z.object({ id: z.string() }),
  component: AgentsRouteView,
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'agent', id }),
  search: [changesSearch.namespace, agentDetailSearch.namespace],
  toReference: ({ id }) => uuidRouteReference(id, 'agent'),
});

export const agentChatsRoute = defineRoute({
  id: 'agent-chats',
  path: 'agents/chat/:id',
  aliases: ['agent-chats/:id'],
  params: z.object({ id: z.string() }),
  component: AgentsRouteView,
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'chat', id }),
  search: [changesSearch.namespace],
  toReference: ({ id }) => uuidRouteReference(id, 'chat'),
});

export const agentsViewRoute = defineRoute({
  id: 'view-agents',
  path: 'agents',
  component: AgentsRouteView,
  search: '*' as const,
  externalSearch: ['createAgent'],
  claim: () => ({ namespace: 'component', id: 'agents' }),
});
