import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
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
        <Notice>{t('dynamicUi.wakesUnavailable')}</Notice>
      </Match>
      <Match when={flag().enabled}>{props.children}</Match>
    </Switch>
  );
}
