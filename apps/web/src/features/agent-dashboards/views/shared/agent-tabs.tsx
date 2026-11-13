import { t } from '@app/lib/i18n';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import { Tabs } from '@ui';

/** The agent page's sections. Wakes and traces join the dashboard later. */
export type AgentPageTab = 'dashboard';

export function AgentTabs(props: {
  value: AgentPageTab;
  onChange: (tab: AgentPageTab) => void;
  class?: string;
}) {
  return (
    <Tabs
      aria-label={t('agentDashboards.sections')}
      size="md"
      touch="inset"
      class={props.class}
      options={[
        {
          value: 'dashboard',
          label: t('agentDashboards.dashboardTab'),
          icon: SquaresFourIcon,
        },
      ]}
      value={props.value}
      onChange={props.onChange}
    />
  );
}
