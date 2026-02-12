//! Redis-backed implementation of [DigestBatcher].

#[cfg(all(test, feature = "redis-tests"))]
mod test;

use crate::domain::models::email_notification_digest::ports::{
    ClaimResult, DigestBatch, DigestBatcher,
};
use crate::domain::models::{TaggedContent, UserNotificationRow};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, SortedSetAddOptions};
use rootcause::Report;
use std::time::Duration;

/// Redis-backed implementation of [DigestBatcher].
///
/// Uses the following Redis keys:
/// - `digest:{user_id}` - List of serialized notifications pending for this user
/// - `digest_pending_users` - Sorted set of user IDs with score = send_at timestamp
///
/// ## Atomicity Strategy
///
/// To prevent race conditions where notifications arriving during processing could be lost,
/// we use the RENAME command to atomically snapshot the pending list:
///
/// 1. `ZPOPMIN` atomically claims a user (only one worker gets them)
/// 2. `RENAME digest:{user_id} digest_processing:{user_id}` atomically snapshots the list
/// 3. Any new notifications now go to a fresh `digest:{user_id}` list
/// 4. Process from `digest_processing:{user_id}` and delete when done
///
/// This ensures no notifications are lost even if new ones arrive during processing.
pub struct RedisDigestBatcher {
    conn: MultiplexedConnection,
}

impl RedisDigestBatcher {
    /// Create a new [RedisDigestBatcher] with the given Redis connection.
    pub fn new(conn: MultiplexedConnection) -> Self {
        Self { conn }
    }

    fn digest_key(user_id: &str) -> String {
        format!("digest:{user_id}")
    }

    fn processing_key(user_id: &str) -> String {
        format!("digest_processing:{user_id}")
    }
}

impl DigestBatcher for RedisDigestBatcher {
    async fn add_to_digest(
        &self,
        notification: &UserNotificationRow<TaggedContent<serde_json::Value>>,
        send_after: Duration,
    ) -> Result<(), Report> {
        let mut conn = self.conn.clone();
        let user_id_str = notification.owner_id.as_ref();
        let digest_key = Self::digest_key(user_id_str);

        let serialized = serde_json::to_string(notification)?;

        // Add notification to user's digest list
        conn.rpush::<_, _, ()>(&digest_key, &serialized).await?;

        // Schedule when to send - NX ensures we only set the time on first notification,
        // subsequent notifications don't push back the send time
        let send_at = Utc::now().timestamp() + send_after.as_secs() as i64;
        conn.zadd_options::<_, _, _, ()>(
            "digest_pending_users",
            user_id_str,
            send_at,
            &SortedSetAddOptions::add_only(),
        )
        .await?;

        Ok(())
    }

    async fn claim_ready_digest(&self) -> Result<ClaimResult, Report> {
        let mut conn = self.conn.clone();
        let now = Utc::now().timestamp();

        // Step 1: Atomically pop one user from the pending set
        // Only one worker will receive this user
        let result: Vec<(String, f64)> = conn.zpopmin("digest_pending_users", 1).await?;

        let Some((user_id_str, score)) = result.into_iter().next() else {
            return Ok(ClaimResult::Empty);
        };

        // Check if this digest is actually ready to send
        if score > now as f64 {
            // Not ready yet, put it back
            conn.zadd::<_, _, _, ()>("digest_pending_users", &user_id_str, score)
                .await?;

            // Return how long to wait until this digest is ready
            let wait_secs = (score as i64) - now;
            return Ok(ClaimResult::Wait(Duration::from_secs(wait_secs as u64)));
        }

        let digest_key = Self::digest_key(&user_id_str);
        let processing_key = Self::processing_key(&user_id_str);

        // Step 2: Atomically snapshot the list via RENAME
        // After this, any new notifications for this user go to a fresh digest:{user_id}
        // and won't be affected by our processing
        let rename_result: Result<(), redis::RedisError> =
            conn.rename(&digest_key, &processing_key).await;

        if rename_result.is_err() {
            // Key doesn't exist - digest was empty (shouldn't happen, but handle gracefully)
            return Ok(ClaimResult::Empty);
        }

        // Step 3: Read from the snapshot and clean up
        let items: Vec<String> = conn.lrange(&processing_key, 0, -1).await?;
        conn.del::<_, ()>(&processing_key).await?;

        if items.is_empty() {
            return Ok(ClaimResult::Empty);
        }

        let user_id = MacroUserIdStr::try_from(user_id_str)?;

        let notifications = items
            .into_iter()
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect();

        Ok(ClaimResult::Ready(DigestBatch {
            user_id,
            notifications,
        }))
    }
}
