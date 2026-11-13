import { ViewShell } from '@app/components/view-shell';
import { UserIcon } from '@core/component/UserIcon';
import { AccountIdentity } from '../components/account-identity';
import { AgentTabs } from './shared/agent-tabs';
import { DashboardBody } from './shared/dashboard-body';
import type { AgentPageProps } from './shared/page-props';

/** An agent account's page: who it is, then its home dashboard full width. */
export function AgentPage(props: AgentPageProps) {
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col text-ink">
      <ViewShell.TopBar class="gap-3">
        <AccountIdentity
          avatar={
            <UserIcon
              id={props.userId}
              name={props.identity.name}
              size="sm"
              suppressClick
            />
          }
          name={props.identity.name}
          isAgent={props.identity.isAgent}
        />
        <AgentTabs
          class="shrink-0"
          value={props.tab}
          onChange={props.onTabChange}
        />
      </ViewShell.TopBar>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex min-h-full w-full max-w-6xl flex-col px-6 pt-4 pb-8">
          <DashboardBody view={props.dashboard} onRetry={props.onRetry} />
        </div>
      </div>
    </div>
  );
}
