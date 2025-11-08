mod remove_set_member;
mod scan;
mod set;

pub use RedisClient as Redis;

#[derive(Clone)]
pub struct RedisClient {
    inner: redis::cluster::ClusterClient,
}

// Key prefixes
static SHA_COUNT_KEY_PREFIX_PATTERN: &str = "sha:*";
static SHA_COUNT_KEY_PREFIX: &str = "sha:";
#[allow(dead_code)]
static SHA_DELETE_BUCKET: &str = "bucket:sha-delete";

impl RedisClient {
    pub fn new(inner: redis::cluster::ClusterClient) -> Self {
        Self { inner }
    }

    pub fn ping(&self) -> anyhow::Result<()> {
        match self.inner.get_connection().is_ok() {
            true => Ok(()),
            false => Err(anyhow::anyhow!("unable to connect to redis")),
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn scan(&self) -> anyhow::Result<Vec<String>> {
        scan::scan(&self.inner).await
    }
    #[tracing::instrument(skip(self, shas))]
    pub async fn set_shas(&self, shas: Vec<(String, i64)>) -> anyhow::Result<()> {
        set::set_shas(&self.inner, shas).await
    }

    #[tracing::instrument(skip(self, shas))]
    pub async fn remove_sha_from_delete_bucket(&self, shas: Vec<String>) -> anyhow::Result<()> {
        remove_set_member::remove_shas_from_delete_bucket(&self.inner, shas).await
    }
}
