/**
 * Hand-written mirrors of the auth service's AI billing OpenAPI types
 * (`crates/ai_billing`). Replace with the orval-generated schemas on the next
 * client regeneration (`bun run gen-api auth-service`).
 *
 * Every money field is in cents at Macro's list rate.
 */

export type AiPlanTier = 'free' | 'premium' | 'max';

export type AiDenyReason =
  | 'allowance_exhausted'
  | 'overage_limit_reached'
  | 'overage_payment_failed';

/** Machine-readable codes carried in 402 bodies from the AI endpoints. */
export type AiDenyCode =
  | 'ai_allowance_exhausted'
  | 'ai_overage_limit_reached'
  | 'ai_overage_payment_failed';

export interface AiUsageSnapshot {
  tier: AiPlanTier;
  unlimited: boolean;
  payer: string;
  can_manage_billing: boolean;
  seats: number;
  period_start: string;
  period_end: string;
  included_cents: number;
  used_cents: number;
  credits_consumed_cents: number;
  credit_balance_cents: number;
  overage_enabled: boolean;
  overage_limit_cents: number;
  overage_charged_cents: number;
  overage_suspended: boolean;
  uncovered_cents: number;
  remaining_cents: number;
  blocked_reason?: AiDenyReason;
}

export interface AiPlanCatalogEntry {
  tier: AiPlanTier;
  monthly_price_cents: number;
  included_ai_cents_per_seat: number;
}

export interface AiPlanCatalog {
  plans: AiPlanCatalogEntry[];
  credit_packs_cents: number[];
  overage_limit_min_cents: number;
  overage_limit_max_cents: number;
}

export type PaidPlan = 'premium' | 'max';
