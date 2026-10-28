//! Postgres adapter for content-hash references.

use crate::domain::ports::ShaCounterPort;

/// Releases content hashes to the Postgres SHA cleanup queue.
#[derive(Clone)]
pub struct ShaCountAdapter {
    sha_references: macro_sha_count_client::ShaReferences,
}

impl ShaCountAdapter {
    /// Create a SHA counter adapter from the shared SHA references.
    pub fn new(sha_references: macro_sha_count_client::ShaReferences) -> Self {
        Self { sha_references }
    }
}

impl ShaCounterPort for ShaCountAdapter {
    #[tracing::instrument(skip(self), err)]
    async fn decrement_counts(&self, sha_counts: &[(String, i64)]) -> anyhow::Result<()> {
        self.sha_references
            .release_shas(sha_counts.iter().map(|(sha, _)| sha.clone()).collect())
            .await
    }
}
