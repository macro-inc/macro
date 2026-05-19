import { LogoProgress } from '@ui';
import type { PaidPlanTier } from './plans';

interface SubscriptionTierProps {
  tier?: PaidPlanTier;
  class?: string;
}

const TIER_TO_LEVEL: Record<PaidPlanTier, number> = {
  haiku: 1,
  sonnet: 2,
  opus: 3,
};

const SubscriptionTier = (props: SubscriptionTierProps) => {
  const level = () => (props.tier ? TIER_TO_LEVEL[props.tier] : 0);
  return <LogoProgress level={level()} total={3} class={props.class} />;
};

export default SubscriptionTier;
