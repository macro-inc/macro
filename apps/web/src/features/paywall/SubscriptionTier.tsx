import type { PaidPlanTier } from './plans';

interface SubscriptionTierProps {
  tier?: PaidPlanTier;
  class?: string;
}

const SubscriptionTier = (props: SubscriptionTierProps) => {
  const active1 = () => props.tier === 'premium';
  const active2 = () => props.tier === 'premium';
  const active3 = () => !!props.tier;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 16"
      class={props.class}
      display="block"
    >
      <path
        d="m15.578 0.043946-2.2441 0.87891v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l1.041 0.98242 7.0859 6.6973 2.2402-0.87891v-6.6758c0-0.2568-0.10497-0.50153-0.29297-0.67773z"
        fill="var(--b4)"
      />
      <path
        d="m6.25 0.041992-2.2422 0.88086v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l1.0391 0.98242 7.084 6.6973 2.2441-0.87891v-6.6758c0-0.2568-0.10302-0.50153-0.29102-0.67773l-1.043-0.98438-7.082-6.6973z"
        fill="var(--b4)"
      />
      <path
        d="m2.252 5.083-2.2422 0.87891v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l2.793 2.6406 2.2441-0.87891v-6.6758c0-0.2568-0.10302-0.50153-0.29102-0.67773z"
        fill="var(--b4)"
      />

      <path
        d="m15.578 0.043946-2.2441 0.87891v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l1.041 0.98242 7.0859 6.6973 2.2402-0.87891v-6.6758c0-0.2568-0.10497-0.50153-0.29297-0.67773z"
        style={{
          transform: `translateY(${active1() ? 0 : 16}px)`,
          transition: 'transform 0.3s ease 0.2s',
          fill: 'var(--a0)',
        }}
      />
      <path
        d="m6.25 0.041992-2.2422 0.88086v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l1.0391 0.98242 7.084 6.6973 2.2441-0.87891v-6.6758c0-0.2568-0.10302-0.50153-0.29102-0.67773l-1.043-0.98438-7.082-6.6973z"
        style={{
          transform: `translateY(${active2() ? 0 : 16}px)`,
          transition: 'transform 0.3s ease 0.1s',
          fill: 'var(--a0)',
        }}
      />
      <path
        d="m2.252 5.083-2.2422 0.87891v6.6758c0 0.2568 0.10697 0.50329 0.29297 0.67969l2.793 2.6406 2.2441-0.87891v-6.6758c0-0.2568-0.10302-0.50153-0.29102-0.67773z"
        style={{
          transform: `translateY(${active3() ? 0 : 16}px)`,
          transition: 'transform 0.3s ease 0s',
          fill: 'var(--a0)',
        }}
      />

      {/*<path fill="var(--b0)" d="m5.3398 9.2617v5.8164l-2.2441 0.87891-2.793-2.6387c-0.186-0.1764-0.29296-0.42289-0.29297-0.67969v3.3613h23.99l-0.0059-0.91992-2.2402 0.87891-7.0859-6.6973v5.8184l-2.2441 0.87891z"/>*/}
    </svg>
  );
};

export default SubscriptionTier;
