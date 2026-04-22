export const PLANS = [
  {
    tier: 'free' as const,
    name: 'Level 0',
    price: 0,
    highlighted: false,
  },
  {
    tier: 'haiku' as const,
    name: 'Level 1',
    price: 20,
    highlighted: false,
  },
  {
    tier: 'sonnet' as const,
    name: 'Level 2',
    price: 60,
    highlighted: false,
  },
  {
    tier: 'opus' as const,
    name: 'Level 3',
    price: 120,
    highlighted: true,
  },
] as const;

export type PlanTier = (typeof PLANS)[number]['tier'];
export type Plan = (typeof PLANS)[number];
/** Tiers that correspond to real Stripe products. Excludes 'free'. */
export type PaidPlanTier = Exclude<PlanTier, 'free'>;

export interface PlanFeature {
  label: string;
  values: Record<PlanTier, string>;
}

export const PLAN_FEATURES: PlanFeature[] = [
  {
    label: 'AI Agent',
    values: {
      free: '—',
      haiku: 'Haiku',
      sonnet: 'Sonnet',
      opus: 'Opus',
    },
  },
  {
    label: 'AI tool calls',
    values: {
      free: '—',
      haiku: '1,000/month',
      sonnet: '5,000/month',
      opus: 'Unlimited',
    },
  },
  {
    label: 'Storage',
    values: {
      free: '5 GB',
      haiku: '25 GB',
      sonnet: '100 GB',
      opus: '1 TB',
    },
  },
];
