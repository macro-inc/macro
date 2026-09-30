//! Shared, snapshot-based admission for user-owned AI work. This is not a reservation.

use super::{AllowanceDecision, BillingService, DenyReason};
use ai_usage::{AiFeature, AiUsageEnforcement};
use macro_user_id::user_id::MacroUserIdStr;
use std::{future::Future, pin::Pin, sync::Arc};

#[cfg(test)]
mod test;

/// Public admission failure. Internal billing diagnostics are logged, never carried here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AiAdmissionError {
    /// The user's allowance policy refuses new work.
    #[error("{}", .0.message())]
    Denied(DenyReason),
    /// Billing could not validate the request. Retry later without starting AI work.
    #[error("AI usage validation is temporarily unavailable. Please try again.")]
    Unavailable,
}

impl AiAdmissionError {
    /// Stable public failure code, also suitable for tools and queued commands.
    pub fn code(self) -> &'static str {
        match self {
            Self::Denied(reason) => reason.code(),
            Self::Unavailable => "ai_billing_unavailable",
        }
    }

    /// Whether a bounded retry may succeed without a billing-policy change.
    pub fn is_retryable(self) -> bool {
        matches!(self, Self::Unavailable)
    }
}

/// Object-safe future returned by the shared admission port.
pub type AdmissionFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>>;

/// Admission for a trusted originating user and a server-selected feature.
/// Call after authorization, before provider calls or AI-related durable state.
/// Never substitute the system identity for an unknown or missing caller.
pub trait AiAdmissionService: Send + Sync + 'static {
    /// Validate new AI work. Denial and validation failure both prevent execution.
    fn admit<'a>(&'a self, user: &'a MacroUserIdStr<'_>, feature: AiFeature)
    -> AdmissionFuture<'a>;
}

/// Explicitly disabled admission for source-compatible constructors and tests.
/// Production composition must inject configured admission instead.
#[derive(Debug, Clone, Copy, Default)]
pub struct DisabledAiAdmissionService;

impl AiAdmissionService for DisabledAiAdmissionService {
    fn admit<'a>(
        &'a self,
        _user: &'a MacroUserIdStr<'_>,
        _feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async { Ok(()) })
    }
}

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
