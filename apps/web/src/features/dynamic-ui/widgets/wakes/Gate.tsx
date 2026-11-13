import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableAgentDashboards } from '@core/constant/featureFlags';
import { type JSX, Match, Switch } from 'solid-js';
import { Notice } from './Notice';

/**
 * Agent wake panes show only with `enable-agent-dashboards`; until the flag
 * answers they show nothing, and with it off a line says so.
 */
export function AgentDashboardsGate(props: { children: JSX.Element }) {
  const flag = useFeatureFlag(enableAgentDashboards);
  return (
    <Switch>
      <Match when={flag().loading}>{null}</Match>
      <Match when={!flag().enabled}>
        <Notice>Agent wakes aren't available yet.</Notice>
      </Match>
      <Match when={flag().enabled}>{props.children}</Match>
    </Switch>
  );
}
