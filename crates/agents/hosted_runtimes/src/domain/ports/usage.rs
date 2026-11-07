//! Port for computers' usage history: the per-minute host readings behind
//! the CPU and memory graphs in Settings.

use std::future::Future;

use chrono::{DateTime, Utc};

use crate::domain::ids::ComputerId;
use crate::domain::usage::{StoredSample, UsageSample};

/// Storage of computers' usage readings.
pub trait UsageHistory: Send + Sync {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Keep `samples`, measured at `sampled_at`, as the readings of the
    /// minute `sampled_at` falls in. A computer that already has that
    /// minute's reading keeps it, so replicas and retries may repeat this;
    /// a computer that no longer exists is skipped. Returns how many were
    /// kept.
    fn record_usage(
        &self,
        sampled_at: DateTime<Utc>,
        samples: &[UsageSample],
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;

    /// Every reading of `computers` whose minute starts at or after `since`,
    /// each computer's oldest first.
    fn usage_since(
        &self,
        computers: &[ComputerId],
        since: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<(ComputerId, StoredSample)>, Self::Err>> + Send;

    /// Delete readings whose minute starts before `before`; returns how many.
    fn prune_usage(
        &self,
        before: DateTime<Utc>,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;
}
