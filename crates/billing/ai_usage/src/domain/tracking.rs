//! Observational evidence, deliberately incapable of authorizing or settling usage.

use super::financial::*;
use super::ports::{AiFeature, FinancialFuture};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use std::sync::Arc;

/// Immutable attribution for an observation, not a funding request or reservation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackedInvocation {
    /// Logical operation identity.
    pub run_id: RunId,
    /// Unique provider execution identity; delivery retries retain this identity.
    pub invocation_id: InvocationId,
    /// Trusted originating user; the system identity is internal work, not a payer.
    pub user: MacroUserIdStr<'static>,
    /// Host-selected feature, including existing excluded features.
    pub feature: AiFeature,
    /// Related entity.
    pub entity: Option<Uuid>,
    /// Actual provider and wire model.
    pub model: ProviderModel,
    /// Time the attempt began.
    pub occurred_at: DateTime<Utc>,
}

/// Awaited observation capability. No funding capability is accepted by this port.
/// Failures must be reported, but must not deny or alter provider execution.
pub trait UsageTracking: Send + Sync {
    /// Persist an attempt before execution when storage is available.
    fn begin(&self, request: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition>;
    /// Persist immutable evidence; identical delivery is idempotent.
    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition>;
}

/// Storage port owned by the observation domain. It never schedules financial handoffs.
pub trait UsageTrackingRepo: UsageTracking {}

/// Owning-domain observation service. There is intentionally no funding or collection
/// dependency and no conversion from observations into authorized invocations.
pub struct UsageTrackingService {
    repo: Arc<dyn UsageTrackingRepo>,
}

impl UsageTrackingService {
    /// Construct at a host composition root.
    pub fn new(repo: Arc<dyn UsageTrackingRepo>) -> Self {
        Self { repo }
    }
}

impl UsageTracking for UsageTrackingService {
    fn begin(&self, request: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        self.repo.begin(request)
    }

    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        self.repo.finalize(evidence)
    }
}

/// Observations are not priced using mutable analytics rates or assumed billing
/// profiles. Preserve counters as unpriced until a separately reviewed pricing path
/// exists; absent counters remain unresolved, never measured zero.
pub fn observation_state(evidence: FinalizeInvocation) -> InvocationState {
    match evidence.usage {
        UsageEvidence::Reported(_) => InvocationState::Unpriced {
            evidence,
            reason: UnpricedReason::MissingRate,
        },
        UsageEvidence::Missing(_) => InvocationState::Unresolved { evidence },
    }
}
