import type { Accessor } from 'solid-js';
import type { PaidPlanTier, PlanTier } from '../../paywall/plans';

/** Billing presentation capabilities, supplied by the app or the local sandbox. */
export type BillingContext = {
  tier: Accessor<PlanTier>;
  renewalDate: Accessor<string | undefined>;
  subscriptionStatusFailed?: Accessor<boolean>;
  refreshStatus?: () => void;
  scheduledChange: Accessor<
    { plan: PlanTier; effectiveAt: string } | undefined
  >;
  hasPaid: Accessor<boolean>;
  aiUsageBilling: Accessor<boolean>;
  teamRole: Accessor<'owner' | 'member' | undefined>;
  teamSeatDescription: Accessor<string | undefined>;
  billedThroughTeam: Accessor<boolean>;
  isOwnerOrSolo: Accessor<boolean>;
  canManageSubscription: Accessor<boolean>;
  canChangePlan: Accessor<boolean>;
  changingPlan: Accessor<boolean>;
  checkout: (plan: PaidPlanTier) => Promise<void>;
  changePlan: (plan: PaidPlanTier) => Promise<void>;
  manage: () => Promise<void>;
  openTeamSettings?: () => void;
};
