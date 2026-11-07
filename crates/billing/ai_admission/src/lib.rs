#![deny(missing_docs)]
//! The admission port for user-owned AI work and its public errors, split out
//! of `ai_billing` so crates that only gate AI work need not compile billing.

use ai_usage::AiFeature;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin};
use utoipa::ToSchema;

pub mod http;

/// Why a request was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, strum::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum DenyReason {
    /// The plan's included AI is used up and no credits or overage remain.
    AllowanceExhausted,
    /// The free plan's monthly AI is used up. Free has no credits or overage;
    /// only an upgrade (or the next month) lifts it.
    FreeAllowanceExhausted,
    /// Overage is on but the payer's per-period cap has been reached.
    OverageLimitReached,
    /// An overage charge failed; overage is paused until the payer re-enables it.
    OveragePaymentFailed,
}

impl DenyReason {
    /// A stable machine-readable code for API error bodies.
    pub fn code(self) -> &'static str {
        match self {
            DenyReason::AllowanceExhausted => "ai_allowance_exhausted",
            DenyReason::FreeAllowanceExhausted => "ai_free_allowance_exhausted",
            DenyReason::OverageLimitReached => "ai_overage_limit_reached",
            DenyReason::OveragePaymentFailed => "ai_overage_payment_failed",
        }
    }

    /// A short human-readable explanation.
    pub fn message(self) -> &'static str {
        match self {
            DenyReason::AllowanceExhausted => {
                "You've used this period's included AI. Add credits or turn on automatic reload to keep going."
            }
            DenyReason::FreeAllowanceExhausted => {
                "You've used this month's free AI. Upgrade to a paid plan to keep going."
            }
            DenyReason::OverageLimitReached => {
                "You've reached your AI spending limit for this period. Raise the limit or add credits to keep going."
            }
            DenyReason::OveragePaymentFailed => {
                "Your last automatic credit reload didn't go through. Update your payment method and re-enable automatic reload."
            }
        }
    }
}

/// Public admission failure. Internal billing diagnostics are logged, never carried here.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, thiserror::Error,
)]
#[serde(rename_all = "snake_case")]
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
