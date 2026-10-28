mod sha_cleanup_queue;

#[allow(unused_imports)]
use mockall::automock;

pub use sha_cleanup_queue::{QueuedSha, ShaClaim};

#[cfg(not(test))]
pub use DBClient as DB;
#[cfg(test)]
pub use MockDBClient as DB;

#[derive(Clone)]
pub struct DBClient {
    inner: sqlx::Pool<sqlx::Postgres>,
}

#[cfg_attr(test, automock)]
impl DBClient {
    pub fn new(inner: sqlx::Pool<sqlx::Postgres>) -> Self {
        Self { inner }
    }

    pub async fn queued_shas(&self) -> anyhow::Result<Vec<QueuedSha>> {
        sha_cleanup_queue::queued_shas(&self.inner).await
    }

    pub async fn claim_sha(&self, queued: &QueuedSha) -> anyhow::Result<Option<ShaClaim>> {
        sha_cleanup_queue::claim_sha(&self.inner, queued).await
    }
}
