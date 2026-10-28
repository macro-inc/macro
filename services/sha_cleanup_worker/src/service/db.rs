mod get_sha_count;
mod sha_cleanup_queue;

#[allow(unused_imports)]
use mockall::automock;

pub use sha_cleanup_queue::QueuedSha;

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

    pub async fn get_sha_count(&self, sha: &str) -> anyhow::Result<i64> {
        get_sha_count::get_sha_count(self.inner.clone(), sha).await
    }

    pub async fn queued_shas(&self) -> anyhow::Result<Vec<QueuedSha>> {
        sha_cleanup_queue::queued_shas(&self.inner).await
    }

    pub async fn dequeue_shas(&self, shas: Vec<QueuedSha>) -> anyhow::Result<()> {
        sha_cleanup_queue::dequeue_shas(&self.inner, shas).await
    }
}
