use crate::util::redis::RedisClient;
use std::time::Duration;

const SNAPSHOT_KEY: &str = "outlook:health_snapshot";

impl RedisClient {
    /// Claims the next Outlook health snapshot with `SET … NX PX`, so one
    /// worker logs it per window however many run. Redis errors fail open:
    /// a duplicate snapshot is harmless, a missing one hides a stall.
    pub async fn claim_outlook_health_snapshot(&self, window: Duration) -> bool {
        let mut connection = match self.inner.get_multiplexed_async_connection().await {
            Ok(connection) => connection,
            Err(error) => {
                tracing::warn!(%error, "Failed to get Redis connection for the Outlook health snapshot");
                return true;
            }
        };
        let claimed: redis::RedisResult<Option<String>> = redis::cmd("SET")
            .arg(SNAPSHOT_KEY)
            .arg("1")
            .arg("NX")
            .arg("PX")
            .arg(u64::try_from(window.as_millis()).unwrap_or(u64::MAX))
            .query_async(&mut connection)
            .await;
        match claimed {
            Ok(claimed) => claimed.is_some(),
            Err(error) => {
                tracing::warn!(%error, "Failed to claim the Outlook health snapshot");
                true
            }
        }
    }
}
