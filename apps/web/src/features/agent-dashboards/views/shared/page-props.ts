import { t } from '@app/lib/i18n';
import type { Accessor } from 'solid-js';
import type { AccountIdentity } from '../../context/dashboard-source';
import { dashboardTitle } from '../../core/dashboard';
import type { DashboardView } from '../../primitives/dashboard-view';
import type { AgentPageTab } from './agent-tabs';

/** What the agent page's desktop and mobile views share. */
export type AgentPageProps = {
  userId: string;
  identity: AccountIdentity;
  tab: AgentPageTab;
  onTabChange: (tab: AgentPageTab) => void;
  dashboard: Accessor<DashboardView>;
  onRetry: () => void;
};

/** What the dashboard page's desktop and mobile views share. */
export type DashboardPageProps = {
  dashboard: Accessor<DashboardView>;
  onRetry: () => void;
};

/** A dashboard page's title: the loaded dashboard's, else a generic one. */
export function dashboardPageTitle(view: DashboardView): string {
  const title = view.t === 'ready' ? dashboardTitle(view.dashboard) : undefined;
  return title ?? t('agentDashboards.dashboardTab');
}
