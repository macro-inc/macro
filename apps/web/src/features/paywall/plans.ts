/** API tier identifiers remain stable; `premium` is displayed as Pro. */
export type PlanTier = 'free' | 'premium' | 'max';
export type Plan = {
  tier: PlanTier;
  name: string;
  price: number;
  highlighted: boolean;
};

/**
 * Included AI per seat per period in cents at provider cost, by tier. The
 * backend owns these numbers; read them from the plan catalog with
 * `useIncludedAiCentsByTier` (`@queries/auth`) rather than hard-coding them.
 * Empty until the catalog has loaded.
 */
export type IncludedAiCentsByTier = Partial<Record<PlanTier, number>>;

/** "$20" for whole dollars, "$12.50" otherwise; undefined while unknown. */
export function formatPlanPrice(cents: number | undefined): string | undefined {
  if (cents === undefined) return undefined;
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString()}`
    : `$${dollars.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}
/** Tiers that correspond to real Stripe products. Excludes 'free'. */
export type PaidPlanTier = Exclude<PlanTier, 'free'>;

const FREE_PLAN = {
  tier: 'free',
  name: 'Free',
  price: 0,
  highlighted: false,
} as const satisfies Plan;

const PREMIUM_PLAN = {
  tier: 'premium',
  name: 'Pro',
  price: 40,
  highlighted: true,
} as const satisfies Plan;

const MAX_PLAN = {
  tier: 'max',
  name: 'Max',
  price: 200,
  highlighted: false,
} as const satisfies Plan;

export const PLANS = [
  FREE_PLAN,
  PREMIUM_PLAN,
  MAX_PLAN,
] as const satisfies Plan[];

export const PLAN_BY_TIER: Record<PlanTier, Plan> = {
  free: FREE_PLAN,
  premium: PREMIUM_PLAN,
  max: MAX_PLAN,
};

/** Older checkout services still use the API tier's old display name. */
export function billingMessage(message: string): string {
  return message.replace(/\bPremium\b/g, PLAN_BY_TIER.premium.name);
}

interface PlanFeature {
  label: string;
  values: Record<PlanTier, string>;
  /** Shown only while the `enable-ai-usage-billing` flag is on. */
  aiUsageBilling?: boolean;
}

/** Product copy for included usage, relative to Pro rather than dollar allowances. */
export const PLAN_USAGE_LABELS: Record<PlanTier, string> = {
  free: 'Limited usage',
  premium: 'Standard usage',
  max: '10× usage',
};

const PLAN_FEATURE_ROWS: PlanFeature[] = [
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
      free: 'Upgrade to continue',
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

/** AI usage rows appear only while usage billing is enabled. */
export function planFeatures(aiUsageBilling: boolean): PlanFeature[] {
  return [
    { label: 'AI usage', values: PLAN_USAGE_LABELS, aiUsageBilling: true },
    ...PLAN_FEATURE_ROWS,
  ].filter((row) => !row.aiUsageBilling || aiUsageBilling);
}
