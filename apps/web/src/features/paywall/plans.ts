export type PlanTier = 'free' | 'premium' | 'max';
export type Plan = {
  tier: PlanTier;
  name: string;
  price: number;
  highlighted: boolean;
  /**
   * AI usage included each month, in dollars at Macro's list rate. Equal to the
   * plan price: the plan's AI allowance is worth what the plan costs.
   */
  aiIncluded: number;
};
/** Tiers that correspond to real Stripe products. Excludes 'free'. */
export type PaidPlanTier = Exclude<PlanTier, 'free'>;

export const PLANS = [
  {
    tier: 'free' as const,
    name: 'Free',
    price: 0,
    highlighted: false,
    aiIncluded: 0,
  },
  {
    tier: 'premium' as const,
    name: 'Premium',
    price: 40,
    highlighted: true,
    aiIncluded: 40,
  },
  {
    tier: 'max' as const,
    name: 'Max',
    price: 200,
    highlighted: false,
    aiIncluded: 200,
  },
] as const satisfies Plan[];

export const PLAN_BY_TIER: Record<PlanTier, Plan> = {
  free: PLANS[0],
  premium: PLANS[1],
  max: PLANS[2],
};

interface PlanFeature {
  label: string;
  values: Record<PlanTier, string>;
}

export const PLAN_FEATURES: PlanFeature[] = [
  {
    label: 'AI usage included',
    values: {
      free: 'Limited',
      premium: '$40 / mo',
      max: '$200 / mo',
    },
  },
  {
    label: 'AI Agent',
    values: {
      free: 'Haiku',
      premium: 'All models',
      max: 'All models',
    },
  },
  {
    label: 'Beyond included',
    values: {
      free: '—',
      premium: 'Credits or usage billing',
      max: 'Credits or usage billing',
    },
  },
  {
    label: 'Storage',
    values: {
      free: '5 GB',
      premium: '1 TB',
      max: '1 TB',
    },
  },
];
