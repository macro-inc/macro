import { fireAndForget } from '@core/util/fireAndForget';
import { BillingSettingsView as BillingView } from '../components/billing-settings-view';
import type { BillingContext } from '../context/billing-context';

export const BillingSettingsView = (props: { context: BillingContext }) => (
  <BillingView
    state={{
      tier: props.context.tier(),
      hasPaid: props.context.hasPaid(),
      trialEligible: props.context.trialEligible?.(),
      aiUsageEnabled: props.context.aiUsageBilling(),
      teamRole: props.context.teamRole(),
      billedThroughTeam: props.context.billedThroughTeam(),
      canManageSubscription: props.context.canManageSubscription(),
      canManageBilling:
        props.context.canManageSubscription() && props.context.isOwnerOrSolo(),
      canChangePlan: props.context.canChangePlan(),
      pending: props.context.changingPlan(),
    }}
    renewalDate={props.context.renewalDate()}
    scheduledChange={props.context.scheduledChange()}
    subscriptionStatusFailed={props.context.subscriptionStatusFailed?.()}
    onRefreshStatus={props.context.refreshStatus}
    teamSeatDescription={props.context.teamSeatDescription()}
    onKeepPlan={(plan) =>
      fireAndForget(props.context.changePlan(plan), 'billing-settings')
    }
    onManage={() => fireAndForget(props.context.manage(), 'billing-settings')}
    onSelectPlan={(plan) =>
      fireAndForget(
        props.context.hasPaid()
          ? props.context.changePlan(plan)
          : props.context.checkout(plan),
        'billing-settings'
      )
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
