/** The product plan exposed to PostHog. */
export type AnalyticsPlanTier = 'free' | 'premium';

/** PostHog properties derived from the user's authoritative license status. */
export type PlanAnalyticsProperties = {
  person: {
    plan_tier: AnalyticsPlanTier;
    has_paid_access: boolean;
  };
  event: {
    plan_tier_at_event: AnalyticsPlanTier;
    has_paid_access_at_event: boolean;
  };
};

/**
 * Maps the auth service's license status to stable PostHog properties.
 *
 * `licenseStatus` represents premium entitlement, including personal, team,
 * and enterprise access. Unknown statuses fail closed to the free plan.
 */
export function getPlanAnalyticsProperties(
  licenseStatus: string | undefined
): PlanAnalyticsProperties {
  const hasPaidAccess =
    licenseStatus === 'active' || licenseStatus === 'trialing';
  const planTier = hasPaidAccess ? 'premium' : 'free';

  return {
    person: {
      plan_tier: planTier,
      has_paid_access: hasPaidAccess,
    },
    event: {
      plan_tier_at_event: planTier,
      has_paid_access_at_event: hasPaidAccess,
    },
  };
}
