import { LogoProgress } from '@ui';
import type { PaidPlanTier } from './plans';

interface SubscriptionTierProps {
  tier?: PaidPlanTier;
  class?: string;
}

const SubscriptionTier = (props: SubscriptionTierProps) => {
  const level = () => (props.tier ? 1 : 0);
  return <LogoProgress level={level()} total={1} class={props.class} />;
};

export default SubscriptionTier;
