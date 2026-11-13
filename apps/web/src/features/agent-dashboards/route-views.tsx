import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useRouteParams } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import { agentDashboardRoute, dashboardRoute } from '@app/routes/routes';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { SplitPanel } from '@components/app/split-panel';
import { enableAgentDashboards } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, isAgentAccount, tryMacroId } from '@core/user';
import { createSignal, type JSX, Show } from 'solid-js';
import type { AccountIdentity } from './context/dashboard-source';
import { createDashboardView } from './primitives/dashboard-view';
import {
  createDashboardSource,
  createHomeDashboardSource,
} from './queries/dashboard-source';
import { AgentPage } from './views/agent-page';
import { DashboardPage } from './views/dashboard-page';
import { MobileAgentPage } from './views/mobile/agent-page';
import { MobileDashboardPage } from './views/mobile/dashboard-page';
import type { AgentPageTab } from './views/shared/agent-tabs';

/**
 * Mounts a dashboard route only once the flag is on; a loading flag is not
 * off, and an off flag sends the pane home. Nothing is fetched before.
 */
function FlagGate(props: { children: JSX.Element }) {
  const flag = useFeatureFlag(enableAgentDashboards);

  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading}>
          <RedirectSplit to={{ type: 'component', id: 'home' }} />
        </Show>
      }
    >
      <SplitPanel.Root>
        <SplitPanel.Body>{props.children}</SplitPanel.Body>
      </SplitPanel.Root>
    </Show>
  );
}

function identityOf(userId: () => string): AccountIdentity {
  return {
    get name() {
      return getDisplayName(tryMacroId(userId()));
    },
    get isAgent() {
      return isAgentAccount(tryMacroId(userId()));
    },
  };
}

/** The agent page: the device switch, over state both views share. */
function AgentDashboardScreen(props: { userId: string }) {
  const viewerId = useUserId();
  const source = createHomeDashboardSource(viewerId, () => props.userId);
  const dashboard = createDashboardView(source);
  const [tab, setTab] = createSignal<AgentPageTab>('dashboard');
  usePageViewTracking('agent-dashboard');
  usePending('dashboard.load', source.isLoading);

  const pageProps = {
    get userId() {
      return props.userId;
    },
    identity: identityOf(() => props.userId),
    get tab() {
      return tab();
    },
    onTabChange: setTab,
    dashboard,
    onRetry: source.retry,
  };

  return (
    <Show when={isTouchDevice()} fallback={<AgentPage {...pageProps} />}>
      <MobileAgentPage {...pageProps} />
    </Show>
  );
}

function DashboardScreen(props: { dashboardId: string }) {
  const viewerId = useUserId();
  const source = createDashboardSource(viewerId, () => props.dashboardId);
  const dashboard = createDashboardView(source);
  usePageViewTracking('dashboard');
  usePending('dashboard.load', source.isLoading);

  return (
    <Show
      when={isTouchDevice()}
      fallback={<DashboardPage dashboard={dashboard} onRetry={source.retry} />}
    >
      <MobileDashboardPage dashboard={dashboard} onRetry={source.retry} />
    </Show>
  );
}

export const AgentDashboardRouteView = withAuth(() => {
  const params = useRouteParams(agentDashboardRoute);

  return (
    <FlagGate>
      <AgentDashboardScreen userId={params.userId} />
    </FlagGate>
  );
});

export const DashboardRouteView = withAuth(() => {
  const params = useRouteParams(dashboardRoute);

  return (
    <FlagGate>
      <DashboardScreen dashboardId={params.dashboardId} />
    </FlagGate>
  );
});
