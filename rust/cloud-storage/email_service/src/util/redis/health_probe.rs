use crate::util::redis::RedisClient;
use std::time::Duration;
use uuid::Uuid;

impl RedisClient {
    /// Claims a per-link probe window with `SET health_probe:{link_id} 1 NX EX ttl`.
    ///
    /// Returns `true` when this caller acquired the window and should run a probe, and
    /// `false` when a probe already ran within `ttl`. The key is never deleted — it
    /// expires with its TTL, so the window stands for the full duration regardless of
    /// how the probe itself fares. Keying on `link_id` (not the caller) means every
    /// sharer of a shared link draws from one window.
    ///
    /// Redis errors fail open (returns `true`): a cache outage must not suppress
    /// detection, and the worst case is a few extra refreshes against the auth service.
    pub async fn try_begin_health_probe(&self, link_id: Uuid, ttl: Duration) -> bool {
        let key = format!("health_probe:{link_id}");

        let mut con = match self.inner.get_multiplexed_async_connection().await {
            Ok(con) => con,
            Err(e) => {
                tracing::warn!(error=?e, %link_id, "Failed to get Redis connection for health probe throttle");
                return true;
            }
        };

        let acquired: Option<String> = match redis::cmd("SET")
            .arg(&key)
            .arg("1")
            .arg("NX")
            .arg("EX")
            .arg(ttl.as_secs())
            .query_async(&mut con)
            .await
        {
            Ok(res) => res,
            Err(e) => {
                tracing::warn!(error=?e, %link_id, "Failed to claim health probe window");
                return true;
            }
        };

        acquired.is_some()
    }
}
