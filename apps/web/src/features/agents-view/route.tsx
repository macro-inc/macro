import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { defineRoute } from '@app/lib/split-router';
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
import { useAutomationEntities } from '@queries/agent-schedule/entities';
import { createRenderEffect, lazy, Show } from 'solid-js';
import { z } from 'zod';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import { parseAgentsRoute } from './core/route';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));
const AgentsView = lazy(async () => ({
  default: (await import('./views/AgentsView')).AgentsView,
}));
const McpConnections = lazy(async () => ({
  default: (await import('../settings/McpConnections')).McpConnections,
}));

function LegacyAgentsView() {
  const user = useUserContext();
  const preset = getViewPreset('agents', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  const entities = useAutomationEntities();
  return (
    <SoupView
      viewName="Agents"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      additionalEntities={entities}
    />
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
  const connectionsRequested = () => {
    const content = panel.handle.content();
    return (
      content.type === 'component' &&
      content.params?.agentPage === 'connections'
    );
  };
  createRenderEffect(() => {
    if (!flag().loading)
      panel.handle.updateMeta?.({
        splitPanelLayout: enabled() ? 'composable' : 'legacy',
      });
  });
  return (
    <Show when={!flag().loading} fallback={<LoadingBlock />}>
      <Show
        when={enabled()}
        fallback={
          <Show
            when={connectionsRequested()}
            fallback={
              <Show when={route()} fallback={<LegacyAgentsView />}>
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
});

export const codersRoute = defineRoute({
  id: 'coders',
  path: 'coders/:id',
  params: z.object({ id: z.string() }),
  component: AgentsRouteView,
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'agent', id }),
});

export const agentChatsRoute = defineRoute({
  id: 'agent-chats',
  path: 'agents/chat/:id',
  aliases: ['agent-chats/:id'],
  params: z.object({ id: z.string() }),
  component: AgentsRouteView,
  remountKey: ({ id }) => id,
  claim: ({ id }) => ({ namespace: 'chat', id }),
});

export const agentsViewRoute = defineRoute({
  id: 'view-agents',
  path: 'agents',
  component: AgentsRouteView,
  search: '*' as const,
  externalSearch: ['createAgent'],
  claim: () => ({ namespace: 'component', id: 'agents' }),
});
