//! Read the caller's scheduled seat change without running usage settlement.

use ai_billing::domain::{EntitlementSource, PlanTier, SubscriptionScope};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::model::ScheduledSeatPlan;

use super::subscription_plan::PlanChangeError;

#[cfg(test)]
mod test;

/// Provider facts for one authenticated subscription scope.
#[derive(Clone)]
pub struct SubscriptionPlanFacts {
    /// End of the subscription's currently effective billing period.
    pub period_end: DateTime<Utc>,
    /// Only the caller's seat, from the currently attached provider schedule.
    pub scheduled_change: Option<ScheduledSeatPlan>,
}

/// Capability for reading customer-scoped subscription and schedule facts.
pub trait SubscriptionStatusGateway: Send + Sync {
    /// Find the live subscription in the trusted scope and its caller-specific change.
    fn status(
        &self,
        customer: &str,
        scope: SubscriptionScope,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<SubscriptionPlanFacts>, PlanChangeError>> + Send;
}

/// Current renewal and scheduled change; empty for accounts without a subscription.
#[derive(Default, Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionStatus {
    /// Provider-confirmed subscription renewal date.
    pub renewal_date: Option<DateTime<Utc>>,
    /// Future downgrade for the caller's seat, if still pending.
    pub scheduled_change: Option<ScheduledSeatPlan>,
}

/// Resolves the caller's payer and scope before reading subscription facts.
pub struct SubscriptionStatusService<E, G> {
    entitlements: E,
    gateway: G,
}

impl<E: EntitlementSource, G: SubscriptionStatusGateway> SubscriptionStatusService<E, G> {
    /// Compose the owning entitlement port with the provider read capability.
    pub fn new(entitlements: E, gateway: G) -> Self {
        Self {
            entitlements,
            gateway,
        }
    }

    /// Return only the authenticated caller's current subscription and future downgrade.
    pub async fn status(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<SubscriptionStatus, PlanChangeError> {
        let entitlement = self
            .entitlements
            .entitlement(user)
            .await
            .map_err(anyhow::Error::from)?;
        if !entitlement.tier.is_paid() || entitlement.unlimited {
            return Ok(SubscriptionStatus::default());
        }
        let Some(customer) = self
            .entitlements
            .stripe_customer_id(&entitlement.payer)
            .await
            .map_err(anyhow::Error::from)?
        else {
            return Ok(SubscriptionStatus::default());
        };
        let Some(facts) = self
            .gateway
            .status(&customer, SubscriptionScope::from(&entitlement.scope), user)
            .await?
        else {
            return Ok(SubscriptionStatus::default());
        };
        // An applied phase or already-Pro seat is not a future downgrade, even
        // while entitlement webhooks or schedule acknowledgements are catching up.
        let scheduled_change = facts.scheduled_change.filter(|change| {
            entitlement.tier == PlanTier::Max
                && change.plan == teams::domain::model::SeatPlan::Premium
                && change.effective_at >= facts.period_end
        });
        Ok(SubscriptionStatus {
            renewal_date: Some(facts.period_end),
            scheduled_change,
        })
    }
}
