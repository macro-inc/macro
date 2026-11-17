import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import type { JSX } from 'solid-js';
import { AgentsSidebarContext, type AgentsSidebarNavigation } from './context';

export function AgentsSidebarRoot(
  props: AgentsSidebarNavigation & { children: JSX.Element }
) {
  return (
    <AgentsSidebarContext.Provider value={props}>
      <ViewSidebar.Root aria-label={t('agentWork.navigation')}>
        {props.children}
      </ViewSidebar.Root>
    </AgentsSidebarContext.Provider>
  );
}
