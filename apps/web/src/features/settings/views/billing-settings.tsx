import { BillingSettingsView as BillingView } from '../components/billing-settings-view';
import type { BillingContext } from '../context/billing-context';

export const BillingSettingsView = (props: { context: BillingContext }) => (
  <BillingView
    state={{
      tier: props.context.tier(),
      hasPaid: props.context.hasPaid(),
      aiUsageEnabled: props.context.aiUsageBilling(),
      teamRole: props.context.teamRole(),
      billedThroughTeam: props.context.billedThroughTeam(),
      canManageSubscription: props.context.canManageSubscription(),
      canChangePlan: props.context.canChangePlan(),
      pending: props.context.changingPlan(),
    }}
    renewalDate={props.context.renewalDate()}
    scheduledChange={props.context.scheduledChange()}
    subscriptionStatusFailed={props.context.subscriptionStatusFailed?.()}
    onRefreshStatus={props.context.refreshStatus}
    teamSeatDescription={props.context.teamSeatDescription()}
    onKeepPlan={(plan) => void props.context.changePlan(plan)}
    onManage={() => void props.context.manage()}
    onSelectPlan={(plan) =>
      void (props.context.hasPaid()
        ? props.context.changePlan(plan)
        : props.context.checkout(plan))
    }
    onTeamSettings={
      props.context.openTeamSettings
        ? (event) => {
            event.preventDefault();
            props.context.openTeamSettings?.();
          }
        : undefined
    }
  />
);
