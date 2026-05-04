import type { PaidPlanTier } from './plans';

interface SubscriptionTierProps {
  tier?: PaidPlanTier;
  class?: string;
}

const SubscriptionTier = (props: SubscriptionTierProps) => {
  const fill1 = () => props.tier === 'opus' ? 'var(--a0)' : 'var(--b4)';
  const fill2 = () => props.tier === 'opus' || props.tier === 'sonnet' ? 'var(--a0)' : 'var(--b4)';
  const fill3 = () => props.tier ? 'var(--a0)' : 'var(--b4)';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 16"
      display="block"
      class={props.class}
    >
      <path fill={fill1()} d="m15.578 0.043946-2.2441 0.87891v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l1.041 0.98242 7.0859 6.6973 2.2402-0.87891v-6.6758c0-0.2568-0.10497-0.50153-0.29297-0.67773z"/>
      <path fill={fill2()} d="m6.25 0.041992-2.2422 0.88086v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l1.0391 0.98242 7.084 6.6973 2.2441-0.87891v-6.6758c0-0.2568-0.10302-0.50153-0.29102-0.67773l-1.043-0.98438-7.082-6.6973z"/>
      <path fill={fill3()} d="m2.252 5.083-2.2422 0.87891v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l2.793 2.6406 2.2441-0.87891v-6.6758c0-0.2568-0.10302-0.50153-0.29102-0.67773z"/>
    </svg>
  );
};

export default SubscriptionTier;
