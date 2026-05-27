const FREE_PLAN = {
  tier: 'free' as const,
  name: 'Level 0',
  price: 0,
  highlighted: false,
};

export const LEGACY_PLANS = [
  { ...FREE_PLAN },
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

export const NEW_PLANS = [
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
] as const;

export type PlanTier = 'free' | 'haiku' | 'sonnet' | 'opus' | 'premium';
export type Plan = {
  tier: PlanTier;
  name: string;
  price: number;
  highlighted: boolean;
};
/** Tiers that correspond to real Stripe products. Excludes 'free'. */
export type PaidPlanTier = Exclude<PlanTier, 'free'>;

/**
 * Default plan list used for tier lookups in onboarding flows. The paywall
 * components import {LEGACY_PLANS, NEW_PLANS} directly based on the
 * runtime feature flag; everywhere else, PLANS provides a stable catalog
 * for `.find(p => p.tier === ...)` lookups.
 */
export const PLANS: readonly Plan[] = LEGACY_PLANS;

interface PlanFeature {
  label: string;
  values: Record<PlanTier, string>;
}

export const PLAN_FEATURES: PlanFeature[] = [
  {
    label: 'AI Tool Calls',
    values: {
      free: '—',
      haiku: '1,000',
      sonnet: '5,000',
      opus: 'Unlimited',
      premium: 'Unlimited',
    },
  },
  {
    label: 'AI Agent',
    values: {
      free: '—',
      haiku: 'Haiku',
      sonnet: 'Sonnet',
      opus: 'Opus',
      premium: 'All models',
    },
  },
  {
    label: 'Storage',
    values: {
      free: '5 GB',
      haiku: '25 GB',
      sonnet: '100 GB',
      opus: '1 TB',
      premium: '1 TB',
    },
  },
];
