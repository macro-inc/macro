import type { BillingInterval } from '@service-auth/generated/schemas/billingInterval';

/** API tier identifiers remain stable; `premium` is displayed as Pro. */
export type PlanTier = 'free' | 'premium' | 'business' | 'max';
/** Pro is bought and run by the customer; Business and Max get onboarding and
 * a contact from the Macro team. */
export type PlanService = 'self-serve' | 'white-glove';
export type Plan = {
  tier: PlanTier;
  name: string;
  /** Month-to-month price per seat, dollars. */
  price: number;
  /** Price per seat per month when billed annually; absent for plans not
   * sold annually. */
  annualPrice?: number;
  service?: PlanService;
  highlighted: boolean;
};

/** The interval a plan's checkout starts on: annual where it is sold. */
export function defaultInterval(tier: PaidPlanTier): BillingInterval {
  return PLAN_BY_TIER[tier].annualPrice === undefined ? 'month' : 'year';
}

/** Whether `tier` can be bought at `interval`. Pro is monthly only. */
export function soldAt(tier: PaidPlanTier, interval: BillingInterval): boolean {
  return interval === 'month' || PLAN_BY_TIER[tier].annualPrice !== undefined;
}

/** A plan's price per seat per month at `interval`, dollars. */
export function planPriceAt(tier: PlanTier, interval: BillingInterval): number {
  const plan = PLAN_BY_TIER[tier];
  if (interval === 'year' && plan.annualPrice !== undefined) {
    return plan.annualPrice;
  }
  return plan.price;
}

/** Plans cheapest first, so a move to a later one is an upgrade. */
const PLAN_ORDER: readonly PlanTier[] = ['free', 'premium', 'business', 'max'];

/** Whether moving from `from` to `to` is an upgrade (charged now) rather
 * than a downgrade (at renewal). */
export function isUpgrade(from: PlanTier, to: PlanTier): boolean {
  return PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);
}

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

const UPGRADE_PLANS: Record<PlanTier, readonly PaidPlanTier[]> = {
  free: ['premium', 'business', 'max'],
  premium: ['business', 'max'],
  business: ['max'],
  max: [],
};

/** The paywall offers only tiers above the current plan. */
export function getUpgradePlans(tier: PlanTier): readonly PaidPlanTier[] {
  return UPGRADE_PLANS[tier];
}

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
  service: 'self-serve',
  highlighted: true,
} as const satisfies Plan;

const BUSINESS_PLAN = {
  tier: 'business',
  name: 'Business',
  price: 90,
  annualPrice: 80,
  service: 'white-glove',
  highlighted: false,
} as const satisfies Plan;

const MAX_PLAN = {
  tier: 'max',
  name: 'Max',
  price: 220,
  annualPrice: 200,
  service: 'white-glove',
  highlighted: false,
} as const satisfies Plan;

export const PLANS = [
  FREE_PLAN,
  PREMIUM_PLAN,
  BUSINESS_PLAN,
  MAX_PLAN,
] as const satisfies Plan[];

export const PLAN_BY_TIER: Record<PlanTier, Plan> = {
  free: FREE_PLAN,
  premium: PREMIUM_PLAN,
  business: BUSINESS_PLAN,
  max: MAX_PLAN,
};

/** Older checkout services still use the API tier's old display name. */
export function billingMessage(message: string): string {
  return message.replace(/\bPremium\b/g, PLAN_BY_TIER.premium.name);
}

interface PlanFeature {
  label: string;
  values: Record<PlanTier, string>;
  /** Shown only where AI usage billing applies. */
  aiUsageBilling?: boolean;
}

/** Product copy for included usage, relative to Pro rather than dollar allowances. */
export const PLAN_USAGE_LABELS: Record<PlanTier, string> = {
  free: 'Limited usage',
  premium: 'Standard usage',
  business: '3× usage',
  max: '10× usage',
};

const PLAN_BENEFITS: Record<PlanTier, (usage: string | undefined) => string[]> =
  {
    free: (usage) => [
      'Access to Haiku',
      ...(usage ? [usage] : []),
      'MCP access',
      '2 connected email accounts',
      '5 GB storage',
    ],
    premium: (usage) => [
      'All agents',
      'All models',
      ...(usage ? [usage] : []),
      'No email watermark',
      'Unlimited connected email accounts',
      '100 GB storage',
    ],
    business: () => [
      'Everything in Pro',
      '3x more AI usage than Pro',
      'Higher routine limits',
      'SSO/SAML, signed DPA, security and IT reviews',
      'Annual contracts and invoicing',
      'White-glove onboarding and priority support',
    ],
    max: () => [
      'Everything in Business',
      '10x more AI usage than Pro',
      '1 TB storage',
    ],
  };

/** Shared Billing/paywall bullets; only Free and Pro usage labels require the flag. */
export function planBenefits(
  tier: PlanTier,
  aiUsageBilling: boolean
): string[] {
  return PLAN_BENEFITS[tier](
    aiUsageBilling ? PLAN_USAGE_LABELS[tier] : undefined
  );
}

const PLAN_FEATURE_ROWS: PlanFeature[] = [
  {
    label: 'AI Agent',
    values: {
      free: 'Haiku',
      premium: 'All models',
      business: 'All models',
      max: 'All models',
    },
  },
  {
    label: 'Beyond included',
    aiUsageBilling: true,
    values: {
      free: 'Upgrade to continue',
      premium: 'Credits or usage billing',
      business: 'Credits or usage billing',
      max: 'Credits or usage billing',
    },
  },
  {
    label: 'Onboarding',
    values: {
      free: 'Self-serve',
      premium: 'Self-serve',
      business: 'White-glove',
      max: 'White-glove',
    },
  },
  {
    label: 'Storage',
    values: {
      free: '5 GB',
      premium: '100 GB',
      business: '500 GB',
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
