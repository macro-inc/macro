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
export function formatIncludedAi(
  cents: number | undefined
): string | undefined {
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
  name: 'Guest',
  price: 0,
  highlighted: false,
} as const satisfies Plan;

const PREMIUM_PLAN = {
  tier: 'premium',
  name: 'Premium',
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

interface PlanFeature {
  label: string;
  values: Record<PlanTier, string>;
  /** Shown only while the `enable-ai-usage-billing` flag is on. */
  aiUsageBilling?: boolean;
}

/**
 * The allowance row; amounts come from the plan catalog, "—" until it loads.
 * Free's amount is its monthly hard cap.
 */
function includedAiRow(includedAi: IncludedAiCentsByTier): PlanFeature {
  const perMonth = (tier: PlanTier) => {
    const amount = formatIncludedAi(includedAi[tier]);
    return amount ? `${amount} / mo at cost` : '—';
  };
  return {
    label: 'AI usage included',
    aiUsageBilling: true,
    values: {
      free: perMonth('free'),
      premium: perMonth('premium'),
      max: perMonth('max'),
    },
  };
}

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

/**
 * The plan comparison rows. The AI usage rows (included allowance and what
 * covers usage beyond it) appear only while AI usage billing is on; callers
 * read `enableAiUsageBilling` and pass its value, and pass the catalog's
 * allowances from `useIncludedAiCentsByTier` so the amounts are never
 * hard-coded here.
 */
export function planFeatures(
  aiUsageBilling: boolean,
  includedAi: IncludedAiCentsByTier = {}
) {
  return [includedAiRow(includedAi), ...PLAN_FEATURE_ROWS].filter(
    (feature) => !feature.aiUsageBilling || aiUsageBilling
  );
}
