use crate::domain::ports::{OAuthStateStore, PendingAuth};
use redis::AsyncCommands;
use std::sync::Arc;

const KEY_PREFIX: &str = "mcp:pending_auth:";
const TTL_SECONDS: u64 = 600;

/// Redis-backed [`OAuthStateStore`] with a 10-minute TTL.
#[derive(Clone)]
pub struct RedisOAuthStateStore {
    client: Arc<redis::Client>,
}

impl RedisOAuthStateStore {
    /// Create a new store from an existing Redis client.
    pub fn new(client: Arc<redis::Client>) -> Self {
        Self { client }
    }
}

impl OAuthStateStore for RedisOAuthStateStore {
    async fn save(&self, csrf_token: &str, pending: PendingAuth) -> anyhow::Result<()> {
        let key = format!("{KEY_PREFIX}{csrf_token}");
        let value = serde_json::to_string(&pending)?;
        let mut conn = self
            .client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| anyhow::anyhow!("redis connection failed: {e}"))?;
        conn.set_ex::<_, _, ()>(&key, &value, TTL_SECONDS).await?;
        Ok(())
    }

    async fn take(&self, csrf_token: &str) -> anyhow::Result<Option<PendingAuth>> {
        let key = format!("{KEY_PREFIX}{csrf_token}");
        let mut conn = self
            .client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| anyhow::anyhow!("redis connection failed: {e}"))?;
        let value: Option<String> = conn.get_del(&key).await?;
        value
            .map(|v| serde_json::from_str(&v))
            .transpose()
            .map_err(Into::into)
    }
}
