import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { UserIcon } from '@core/component/UserIcon';
import { AccountIdentity } from '../../components/account-identity';
import { AgentTabs } from '../shared/agent-tabs';
import { DashboardBody } from '../shared/dashboard-body';
import type { AgentPageProps } from '../shared/page-props';

/**
 * The agent page on touch: Back and the agent's name in the header, then its
 * identity, tabs and dashboard in one column. Dashboard rows already stack
 * below the renderer's container breakpoint, so a phone shows one column.
 */
export function MobileAgentPage(props: AgentPageProps) {
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col text-ink">
      <MobileHeader>
        <MobileHeader.Title label={props.identity.name} />
      </MobileHeader>
      <div class="min-h-0 flex-1 overflow-y-auto pt-[calc(var(--mobile-content-inset-top,0px)+0.5rem)] pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]">
        <div class="flex min-h-full flex-col gap-3 px-(--mobile-chrome-gutter)">
          <AccountIdentity
            avatar={
              <UserIcon
                id={props.userId}
                name={props.identity.name}
                size="md"
                suppressClick
              />
            }
            name={props.identity.name}
            isAgent={props.identity.isAgent}
          />
          <AgentTabs value={props.tab} onChange={props.onTabChange} />
          <DashboardBody view={props.dashboard} onRetry={props.onRetry} />
        </div>
      </div>
    </div>
  );
}
