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

const FREE_PLAN = {
  tier: 'free',
  name: 'Free',
  price: 0,
  highlighted: false,
  aiIncluded: 0,
} as const satisfies Plan;

const PREMIUM_PLAN = {
  tier: 'premium',
  name: 'Premium',
  price: 40,
  highlighted: true,
  aiIncluded: 40,
} as const satisfies Plan;

const MAX_PLAN = {
  tier: 'max',
  name: 'Max',
  price: 200,
  highlighted: false,
  aiIncluded: 200,
} as const satisfies Plan;

export const PLANS = [
  FREE_PLAN,
  PREMIUM_PLAN,
  // MAX_PLAN,
] as const satisfies Plan[];

export const PLAN_BY_TIER: Record<PlanTier, Plan> = {
  free: FREE_PLAN,
  premium: PREMIUM_PLAN,
  max: MAX_PLAN,
};

interface PlanFeature {
  label: string;
  values: Record<PlanTier, string>;
  /** Shown only while the `enable-ai-usage-billing` flag is on. */
  aiUsageBilling?: boolean;
}

const PLAN_FEATURE_ROWS: PlanFeature[] = [
  {
    label: 'AI usage included',
    aiUsageBilling: true,
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
    aiUsageBilling: true,
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

/**
 * The plan comparison rows. The AI usage rows (included allowance and what
 * covers usage beyond it) appear only while AI usage billing is on; callers
 * read `enableAiUsageBilling` and pass its value.
 */
export function planFeatures(aiUsageBilling: boolean) {
  return PLAN_FEATURE_ROWS.filter(
    (feature) => !feature.aiUsageBilling || aiUsageBilling
  );
}
