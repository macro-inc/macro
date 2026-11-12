//! Read the caller's scheduled seat change without running usage settlement.

use ai_billing::domain::{EntitlementSource, PlanTier, SubscriptionScope};
use chrono::{DateTime, Utc};
use hosted_runtimes::domain::rollout::ComputerRollout;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use teams::domain::model::ScheduledSeatPlan;

use super::subscription_plan::PlanChangeError;

mod billing;
pub(crate) mod billing_facts;
pub use billing::{
    SubscriptionBilling, SubscriptionBillingLineItem, SubscriptionBillingLineKind,
    SubscriptionNextInvoice, SubscriptionSeatTotal,
};

#[cfg(test)]
mod test;

/// Provider facts for one authenticated subscription scope.
#[derive(Clone)]
pub struct SubscriptionPlanFacts {
    /// End of the subscription's currently effective billing period.
    pub period_end: DateTime<Utc>,
    /// Only the caller's seat, from the currently attached provider schedule.
    pub scheduled_change: Option<ScheduledSeatPlan>,
    /// Actual provider billing details, exposed only to its billing administrator.
    pub billing: Option<billing_facts::SubscriptionBillingFacts>,
}

/// Capability for reading customer-scoped subscription and schedule facts.
pub trait SubscriptionStatusGateway: Send + Sync {
    /// Trusted membership facts; the service decides whether to read financial details.
    fn billing_access(
        &self,
        scope: SubscriptionScope,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<billing_facts::BillingAccess, PlanChangeError>> + Send;

    /// Find the live subscription in the trusted scope and its caller-specific change.
    fn status(
        &self,
        customer: &str,
        scope: SubscriptionScope,
        user: &MacroUserIdStr<'_>,
        read_billing: bool,
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
    /// Actual provider billing details, exposed only to its billing administrator.
    pub billing: Option<SubscriptionBilling>,
}

/// Resolves the caller's payer and scope before reading subscription facts.
pub struct SubscriptionStatusService<E, G> {
    entitlements: E,
    gateway: G,
    /// The billing breakdown belongs to Macro computers; off, status reads as before them.
    rollout: ComputerRollout,
}

impl<E: EntitlementSource, G: SubscriptionStatusGateway> SubscriptionStatusService<E, G> {
    /// Compose the owning entitlement port with the provider read capability.
    pub fn new(entitlements: E, gateway: G, rollout: ComputerRollout) -> Self {
        Self {
            entitlements,
            gateway,
            rollout,
        }
    }

    /// Return only the authenticated caller's current subscription and future downgrade.
    #[tracing::instrument(name = "billing.subscription.status", skip_all, fields(team_id = tracing::field::Empty, billing_allowed = tracing::field::Empty), err)]
    pub async fn status(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<SubscriptionStatus, PlanChangeError> {
        let entitlement = self
            .entitlements
            .entitlement(user)
            .await
            .map_err(anyhow::Error::from)?;
        if !entitlement.tier.is_paid() {
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
        let scope = SubscriptionScope::from(&entitlement.scope);
        if let SubscriptionScope::Team { team_id } = scope {
            tracing::Span::current().record("team_id", tracing::field::display(team_id));
        }
        let read_billing = self.rollout.enabled(&user.clone().into_owned()).await
            && self.gateway.billing_access(scope, user).await?.can_view();
        tracing::Span::current().record("billing_allowed", read_billing);
        let Some(facts) = self
            .gateway
            .status(&customer, scope, user, read_billing)
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
            billing: if read_billing {
                facts
                    .billing
                    .and_then(billing_facts::SubscriptionBillingFacts::render)
            } else {
                None
            },
        })
    }
}
