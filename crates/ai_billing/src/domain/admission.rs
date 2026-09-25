//! Transport-neutral admission for a new AI operation, not its internal model calls.

#[cfg(test)]
mod test;

use super::{AllowanceDecision, BillingService, DenyReason};
use ai_usage::domain::{AiFeature, SYSTEM_USER_ID};
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use std::pin::Pin;

/// Features measured for cost telemetry but excluded from quota consumption.
/// Usage readers must exclude this same set when calculating billed usage.
pub const QUOTA_EXEMPT_FEATURES: [AiFeature; 3] = [
    AiFeature::AiProjection,
    AiFeature::AiEditing,
    AiFeature::Dictation,
];

/// Whether a server-selected feature may run without billing allowance.
pub fn is_quota_exempt(feature: AiFeature) -> bool {
    QUOTA_EXEMPT_FEATURES.contains(&feature)
}

/// A quota refusal or a retryable failure to determine billing allowance.
/// Transport adapters must never expose the diagnostic report to clients.
#[derive(Debug, thiserror::Error)]
pub enum AiAdmissionError {
    /// The existing billing policy refused another operation.
    #[error("{}", .0.message())]
    Denied(DenyReason),
    /// Billing could not be checked. The report is for internal diagnostics only;
    /// the display message deliberately contains no underlying failure details.
    #[error("AI billing is unavailable. Please try again.")]
    Unavailable(rootcause::Report),
}

impl AiAdmissionError {
    /// Stable public code shared by transports and background-operation replies.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Denied(reason) => reason.code(),
            Self::Unavailable(_) => "ai_billing_unavailable",
        }
    }
}

/// Narrow, object-safe port for admitting a new AI operation.
///
/// Callers must supply the authenticated actor (or a persisted job/session owner)
/// and a server-selected feature, never a client-selected billing identity or
/// exemption. The reserved system identity is only for genuinely system-owned
/// work; it must never replace a missing authenticated user.
///
/// Admission does not reserve budget or interrupt operations already in flight.
/// Authorization and model access remain the caller's responsibility.
pub trait AiAdmissionService: Send + Sync + 'static {
    /// Check once before starting an independently initiated operation.
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>>;
}

/// Admission backed by the existing billing service's snapshot-based policy.
#[derive(Clone)]
pub struct BillingAdmissionService<B: BillingService> {
    billing: B,
}

impl<B: BillingService> BillingAdmissionService<B> {
    /// Wrap a billing service without introducing settlement or payment calls.
    pub fn new(billing: B) -> Self {
        Self { billing }
    }
}

impl<B: BillingService> AiAdmissionService for BillingAdmissionService<B> {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>> {
        Box::pin(async move {
            if is_quota_exempt(feature) || user.as_ref() == SYSTEM_USER_ID.as_ref() {
                return Ok(());
            }
            let decision = self.billing.check_allowance(user).await.map_err(|error| {
                AiAdmissionError::Unavailable(rootcause::Report::new(error).into())
            })?;
            match decision {
                AllowanceDecision::Allow => Ok(()),
                AllowanceDecision::Deny(reason) => Err(AiAdmissionError::Denied(reason)),
            }
        })
    }
}

/// Fail-closed placeholder for additive wiring. Production composition must
/// replace it with a configured service before enabling AI operations.
/// It rejects every request, including quota-exempt features and system work.
#[derive(Debug, Clone, Copy, Default)]
pub struct UnconfiguredAiAdmissionService;

impl AiAdmissionService for UnconfiguredAiAdmissionService {
    fn admit<'a>(
        &'a self,
        _user: &'a MacroUserIdStr<'_>,
        _feature: AiFeature,
    ) -> Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>> {
        Box::pin(async {
            Err(AiAdmissionError::Unavailable(rootcause::report!(
                "AI admission service is not configured"
            )))
        })
    }
}
