#![deny(missing_docs)]

//! AI cost logging — a robust log of AI usage with a flexible admin query API.
//!
//! The crate follows the hexagonal layout used elsewhere in this workspace:
//! - [`domain`] holds the cost model, ports, and the service that computes
//!   cost from a model id and token counts, audio duration, or provider credits.
//! - [`outbound`] holds the Postgres storage adapter.
//! - [`inbound`] holds the axum router mounted in the document cognition
//!   service (DCS).
//!
//! The agent crate records usage through the [`UsageRecorder`](domain::UsageRecorder)
//! port; analytics recording is best-effort and never fails the originating call.
//! Activated billable traffic additionally requires the awaited, object-safe
//! [`FinancialUsage`] capability. [`financial`] defines immutable provider evidence,
//! exact public usage/customer money, and fail-closed capability selection.

pub mod config;
pub mod domain;
pub mod inbound;
pub mod outbound;

#[cfg(test)]
mod test;

pub use domain::counting::{AiUsageEnforcement, NON_BILLABLE_AI_FEATURES, is_billable_feature};
pub use domain::financial;
pub use domain::financial_service::{
    CacheWritePolicy, CounterSemantics, FinancialRateCatalog, FinancialUsageRepo,
    FinancialUsageService, PreparedInvocation, RatePublication,
};
pub use domain::tracking::{
    TrackedInvocation, UsageTracking, UsageTrackingRepo, UsageTrackingService,
};
pub use domain::{
    AiFeature, CompletionUsage, FeatureUsage, FinancialFuture, FinancialRateResolver,
    FinancialUsage, InvocationFunding, ModelPricing, NoOpUsageRecorder, Price, SYSTEM_USER_ID,
    Usage, UsageAmount, UsageApiParams, UsageContext, UsageEvent, UsageRecorder, UsageRepo,
    UsageService, UsageSummary, normalize_model_id,
};

use macro_uuid::Uuid;
use std::sync::Arc;

/// Construct the owning-domain observational journal, without financial adapters.
pub fn pg_tracking(pool: sqlx::PgPool) -> Arc<dyn UsageTracking> {
    Arc::new(UsageTrackingService::new(Arc::new(
        outbound::pg_tracking_repo::PgTrackingRepo::new(pool),
    )))
}

/// Add per-attempt observation without changing the existing analytics/settlement
/// path. Observations never call `record` and cannot trigger collection.
pub fn with_tracking(
    analytics: Arc<dyn UsageRecorder>,
    tracking: Arc<dyn UsageTracking>,
) -> Arc<dyn UsageRecorder> {
    Arc::new(TrackingRecorder {
        analytics,
        tracking,
    })
}

struct TrackingRecorder {
    analytics: Arc<dyn UsageRecorder>,
    tracking: Arc<dyn UsageTracking>,
}

impl UsageRecorder for TrackingRecorder {
    fn record(&self, event: UsageEvent) {
        self.analytics.record(event);
    }

    fn tracking(&self) -> Option<Arc<dyn UsageTracking>> {
        Some(self.tracking.clone())
    }
}

/// Record every event as part of `agent_session_id` unless it already names a
/// session. A host wraps the recorder it hands a session's tools in this, so
/// what any tool records counts toward the session's spend.
pub fn for_agent_session(
    recorder: Arc<dyn UsageRecorder>,
    agent_session_id: Uuid,
) -> Arc<dyn UsageRecorder> {
    Arc::new(AgentSessionRecorder {
        recorder,
        agent_session_id,
    })
}

struct AgentSessionRecorder {
    recorder: Arc<dyn UsageRecorder>,
    agent_session_id: Uuid,
}

impl UsageRecorder for AgentSessionRecorder {
    fn record(&self, mut event: UsageEvent) {
        event.agent_session_id.get_or_insert(self.agent_session_id);
        self.recorder.record(event);
    }

    fn tracking(&self) -> Option<Arc<dyn UsageTracking>> {
        self.recorder.tracking()
    }
}

/// Build Postgres analytics with a separate awaited observational capability.
/// Producers must bind that capability per operation; `record` remains analytics-only.
///
/// Internal/evaluation callers may use this disabled default. Production hosts
/// must use [`pg_recorder_with_enforcement`] with their startup configuration.
pub fn pg_recorder(pool: sqlx::PgPool) -> Arc<dyn UsageRecorder> {
    pg_recorder_with_enforcement(pool, AiUsageEnforcement::Disabled)
}

/// Build configured prospective usage counting, retaining observational tracking.
/// This does not enable financial accounting or settlement.
pub fn pg_recorder_with_enforcement(
    pool: sqlx::PgPool,
    enforcement: AiUsageEnforcement,
) -> Arc<dyn UsageRecorder> {
    let analytics = Arc::new(
        domain::service::UsageServiceImpl::new(outbound::PgUsageRepo::new(pool.clone()))
            .with_enforcement(enforcement),
    );
    with_tracking(analytics, pg_tracking(pool))
}
