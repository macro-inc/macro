//! Redis adapter for content-hash reference counts.

use crate::domain::ports::ShaCounterPort;

/// Redis-backed content-hash counter adapter.
#[derive(Clone)]
pub struct ShaCountAdapter {
    redis: macro_sha_count_client::Redis,
}

impl ShaCountAdapter {
    /// Create a SHA counter adapter from the shared Redis client.
    pub fn new(redis: macro_sha_count_client::Redis) -> Self {
        Self { redis }
    }
}

impl ShaCounterPort for ShaCountAdapter {
    #[tracing::instrument(skip(self), err)]
    async fn decrement_counts(&self, sha_counts: &[(String, i64)]) -> anyhow::Result<()> {
        self.redis.decrement_counts(&sha_counts.to_vec()).await
    }
}
