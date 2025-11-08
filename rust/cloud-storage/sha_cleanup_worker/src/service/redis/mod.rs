mod get_shas;
mod increment;
mod remove_set_member;

#[allow(unused_imports)]
use mockall::automock;

#[cfg(test)]
pub use MockRedisClient as Redis;
#[cfg(not(test))]
pub use RedisClient as Redis;

#[derive(Clone)]
pub struct RedisClient {
    inner: redis::cluster::ClusterClient,
}

// Key prefixes
static SHA_COUNT_KEY_PREFIX: &str = "sha:";
static SHA_DELETE_BUCKET: &str = "bucket:sha-delete";

#[cfg_attr(test, automock)]
impl RedisClient {
    pub fn new(inner: redis::cluster::ClusterClient) -> Self {
        Self { inner }
    }

    pub fn ping(&self) -> Result<(), anyhow::Error> {
        match self.inner.get_connection().is_ok() {
            true => Ok(()),
            false => Err(anyhow::anyhow!("unable to connect to redis")),
        }
    }

    pub async fn get_shas_from_delete_bucket(&self) -> Result<Vec<String>, anyhow::Error> {
        get_shas::get_set_members(&self.inner, SHA_DELETE_BUCKET).await
    }

    pub async fn set_sha_count(&self, sha: &str, count: i64) -> Result<(), anyhow::Error> {
        increment::increment(
            &self.inner,
            format!("{SHA_COUNT_KEY_PREFIX}{sha}").as_str(),
            count,
        )
        .await
    }

    pub async fn remove_sha_from_set(&self, sha: &str) -> Result<(), anyhow::Error> {
        remove_set_member::remove_set_member(&self.inner, SHA_DELETE_BUCKET, sha).await
    }

    pub async fn remove_shas_from_set(&self, shas: Vec<String>) -> Result<(), anyhow::Error> {
        remove_set_member::remove_set_members(&self.inner, SHA_DELETE_BUCKET, shas).await
    }
}

#[cfg(test)]
mod tests {
    use crate::service::redis::Redis;

    #[test]
    fn test_ping() {
        let mut mock = Redis::default();
        mock.expect_ping().with().return_once(|| Ok(()));

        let result = mock.ping();

        assert_eq!(result.is_ok(), true);
    }
}
