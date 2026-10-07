/**
 * Hand-written mirrors of the auth service's AI billing OpenAPI types
 * (`crates/ai_billing`). Replace with the orval-generated schemas on the next
 * client regeneration (`bun run gen-api auth-service`).
 *
 * Allowance and usage fields (`included_cents`, `used_cents`,
 * `remaining_cents`) are cents at provider cost. Credits, overage charges,
 * caps, packs and `uncovered_cents` are customer cents.
 */

export type AiPlanTier = 'free' | 'premium' | 'max';

export type AiDenyReason =
  | 'allowance_exhausted'
  | 'free_allowance_exhausted'
  | 'overage_limit_reached'
  | 'overage_payment_failed';

/** Machine-readable codes carried in 402 bodies from the AI endpoints. */
export type AiDenyCode =
  | 'ai_allowance_exhausted'
  | 'ai_free_allowance_exhausted'
  | 'ai_overage_limit_reached'
  | 'ai_overage_payment_failed';

/** The payer's automatic reload settings and whether reloads will fire. */
export interface AiAutoReloadSnapshot {
  /** Reload once the effective balance drops below this, customer cents. */
  minimum_balance_cents: number;
  /** Reload the balance back up to this, customer cents. */
  target_balance_cents: number;
  /** Most reloaded per UTC calendar month; `null` when there is no limit. */
  monthly_spend_limit_cents: number | null;
  /** Reloads are paused after a failed reload charge. */
  suspended: boolean;
  /** Overage is on and reloads are not suspended. */
  active: boolean;
}

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
  /** Optional until the next client regeneration; always present from the backend. */
  auto_reload?: AiAutoReloadSnapshot;
  uncovered_cents: number;
  remaining_cents: number;
  blocked_reason?: AiDenyReason;
}

export interface AiPlanCatalogEntry {
  tier: AiPlanTier;
  monthly_price_cents: number;
  included_ai_cents_per_seat: number;
  purchasable: boolean;
}

/** Thresholds automatic reload starts from before the payer sets their own. */
export interface AiAutoReloadDefaults {
  minimum_balance_cents: number;
  target_balance_cents: number;
}

export interface AiPlanCatalog {
  plans: AiPlanCatalogEntry[];
  credit_packs_cents: number[];
  overage_limit_min_cents: number;
  overage_limit_max_cents: number;
  /** Optional until the next client regeneration; always present from the backend. */
  auto_reload_target_max_cents?: number;
  /** Optional until the next client regeneration; always present from the backend. */
  auto_reload_defaults?: AiAutoReloadDefaults;
}

export type PaidPlan = 'premium' | 'max';

/**
 * A team member with the plan their seat is billed at. Mirrors the auth
 * service's `TeamMember` once `plan` lands in the generated schema.
 */
export interface TeamMemberPlan {
  team_id: string;
  user_id: string;
  role: 'member' | 'admin' | 'owner';
  plan: PaidPlan;
}
