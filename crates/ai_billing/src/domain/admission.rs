//! Shared, snapshot-based admission for user-owned AI work. This is not a reservation.

use super::{AllowanceDecision, BillingService};
use ai_usage::{AiFeature, AiUsageEnforcement};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

#[cfg(test)]
mod test;

pub use ai_admission::{
    AdmissionFuture, AiAdmissionError, AiAdmissionService, DisabledAiAdmissionService,
};

/// Shared policy gate around an existing billing service; never requests settlement.
pub struct BillingAdmissionService<B> {
    billing: Arc<B>,
    enforcement: AiUsageEnforcement,
}

impl<B: BillingService> BillingAdmissionService<B> {
    /// Wrap billing configured with the same enforcement policy. Existing billing
    /// instances can be shared with summaries and usage recorders via `Arc`.
    pub fn new(billing: Arc<B>, enforcement: AiUsageEnforcement) -> Self {
        Self {
            billing,
            enforcement,
        }
    }
}

impl<B: BillingService> AiAdmissionService for BillingAdmissionService<B> {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        // Use exactly the counting policy, before touching any billing port.
        if !self.enforcement.should_count(user, feature) {
            return Box::pin(async { Ok(()) });
        }
        Box::pin(async move {
            match self.billing.check_allowance(user).await {
                Ok(AllowanceDecision::Allow) => Ok(()),
                Ok(AllowanceDecision::Deny(reason)) => Err(AiAdmissionError::Denied(reason)),
                Err(error) => {
                    tracing::error!(error = ?error, "AI admission validation failed");
                    Err(AiAdmissionError::Unavailable)
                }
            }
        })
    }
}
