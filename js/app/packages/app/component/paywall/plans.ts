export type PlanTier = 'free' | 'premium';
export type Plan = {
  tier: PlanTier;
  name: string;
  price: number;
  highlighted: boolean;
};
/** Tiers that correspond to real Stripe products. Excludes 'free'. */
export type PaidPlanTier = Exclude<PlanTier, 'free'>;

export const PLANS = [
  {
    tier: 'free' as const,
    name: 'Free',
    price: 0,
    highlighted: false,
  },
  {
    tier: 'premium' as const,
    name: 'Premium',
    price: 40,
    highlighted: true,
  },
] as const satisfies Plan[];

interface PlanFeature {
  label: string;
  values: Record<PlanTier, string>;
}

export const PLAN_FEATURES: PlanFeature[] = [
  {
    label: 'AI Tool Calls',
    values: {
      free: '—',
      premium: 'Unlimited',
    },
  },
  {
    label: 'AI Agent',
    values: {
      free: 'Haiku',
      premium: 'All models',
    },
  },
  {
    label: 'Storage',
    values: {
      free: '5 GB',
      premium: '1 TB',
    },
  },
];
