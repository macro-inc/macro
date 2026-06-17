#![deny(missing_docs)]

//! AI cost logging — a robust log of AI usage with a flexible admin query API.
//!
//! The crate follows the hexagonal layout used elsewhere in this workspace:
//! - [`domain`] holds the cost model, ports, and the service that computes
//!   cost from a model id and token counts.
//! - [`outbound`] holds the Postgres storage adapter.
//! - [`inbound`] holds the axum router mounted in the document cognition
//!   service (DCS).
//!
//! The agent crate records usage through the [`UsageRecorder`](domain::UsageRecorder)
//! port; recording is best-effort and never fails the originating call.

pub mod domain;
pub mod inbound;
pub mod outbound;

pub use domain::{
    AiFeature, CompletionUsage, FeatureUsage, Price, SYSTEM_USER_ID, Usage, UsageApiParams,
    UsageContext, UsageEvent, UsageRecorder, UsageRepo, UsageService, UsageSummary,
};

use std::sync::Arc;

/// Build a [`UsageRecorder`] backed by Postgres over `pool`.
///
/// Services construct one of these and thread it into their tool/service
/// context (and into AI call sites) — there is no global recorder.
pub fn pg_recorder(pool: sqlx::PgPool) -> Arc<dyn UsageRecorder> {
    Arc::new(domain::service::UsageServiceImpl::new(
        outbound::PgUsageRepo::new(pool),
    ))
}
