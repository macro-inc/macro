//! Redis-backed implementation of [DigestBatcher].

#[cfg(all(test, feature = "redis-tests"))]
mod test;

use crate::domain::models::UserNotificationRow;
use crate::domain::models::email_notification_digest::ports::{
    ClaimResult, DigestBatch, DigestBatcher,
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Script};
use rootcause::Report;
use std::time::Duration;

/// Redis-backed implementation of [DigestBatcher].
///
/// Uses the following Redis keys:
/// - `digest:{user_id}` - List of serialized notifications pending for this user
/// - `digest_pending_users` - Sorted set of user IDs with score = send_at timestamp
/// - `digest_receipt:{user_id}:{notification_id}:{generation}` - durable ingress receipt
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
    key_prefix: String,
}

impl RedisDigestBatcher {
    /// Create a new [RedisDigestBatcher] with the given Redis connection.
    pub fn new(conn: MultiplexedConnection) -> Self {
        Self {
            conn,
            key_prefix: String::new(),
        }
    }

    /// Create a new [RedisDigestBatcher] with a key prefix for namespace isolation.
    #[cfg(all(test, feature = "redis-tests"))]
    pub(crate) fn with_key_prefix(conn: MultiplexedConnection, prefix: impl Into<String>) -> Self {
        Self {
            conn,
            key_prefix: prefix.into(),
        }
    }

    fn digest_key(&self, user_id: &str) -> String {
        if self.key_prefix.is_empty() {
            format!("digest:{user_id}")
        } else {
            format!("{}:digest:{user_id}", self.key_prefix)
        }
    }

    fn processing_key(&self, user_id: &str) -> String {
        if self.key_prefix.is_empty() {
            format!("digest_processing:{user_id}")
        } else {
            format!("{}:digest_processing:{user_id}", self.key_prefix)
        }
    }

    fn pending_users_key(&self) -> String {
        if self.key_prefix.is_empty() {
            "digest_pending_users".to_string()
        } else {
            format!("{}:digest_pending_users", self.key_prefix)
        }
    }

    fn receipt_key(
        &self,
        user_id: &str,
        notification_id: uuid::Uuid,
        delivery_generation: uuid::Uuid,
    ) -> String {
        if self.key_prefix.is_empty() {
            format!("digest_receipt:{user_id}:{notification_id}:{delivery_generation}")
        } else {
            format!(
                "{}:digest_receipt:{user_id}:{notification_id}:{delivery_generation}",
                self.key_prefix,
            )
        }
    }
}

impl DigestBatcher for RedisDigestBatcher {
    async fn add_to_digest(
        &self,
        notification: &UserNotificationRow<serde_json::Value>,
        send_after: Duration,
    ) -> Result<(), Report> {
        let mut conn = self.conn.clone();
        let user_id_str = notification.owner_id.as_ref();
        let digest_key = self.digest_key(user_id_str);
        let pending_users_key = self.pending_users_key();

        let serialized = serde_json::to_string(notification)?;
        let send_at = Utc::now().timestamp() + send_after.as_secs() as i64;
        let script = Script::new(
            r#"
            redis.call('RPUSH', KEYS[1], ARGV[1])
            redis.call('ZADD', KEYS[2], 'NX', ARGV[2], ARGV[3])
            return 1
            "#,
        );
        let _: i32 = script
            .key(digest_key)
            .key(pending_users_key)
            .arg(serialized)
            .arg(send_at)
            .arg(user_id_str)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    async fn add_to_digest_for_delivery_generation(
        &self,
        notification: &UserNotificationRow<serde_json::Value>,
        delivery_generation: uuid::Uuid,
        send_after: Duration,
    ) -> Result<(), Report> {
        let mut conn = self.conn.clone();
        let user_id_str = notification.owner_id.as_ref();
        let digest_key = self.digest_key(user_id_str);
        let pending_users_key = self.pending_users_key();
        let receipt_key = self.receipt_key(
            user_id_str,
            notification.notification_id,
            delivery_generation,
        );

        let serialized = serde_json::to_string(notification)?;
        let send_at = Utc::now().timestamp() + send_after.as_secs() as i64;

        // Preparation leases protect the Postgres outbox commit, but cannot roll
        // back a Redis side effect if a claimant expires or crashes afterwards.
        // Record the notification id and enqueue/schedule it in one Redis script,
        // so replaying the state machine is safe. The outbox has no retry
        // horizon, so the receipt must not expire independently; coordinated
        // cleanup is only safe after the outbox reaches a terminal state.
        let script = Script::new(
            r#"
            local inserted = redis.call('SET', KEYS[1], '1', 'NX')
            if not inserted then
                return 0
            end
            redis.call('RPUSH', KEYS[2], ARGV[1])
            redis.call('ZADD', KEYS[3], 'NX', ARGV[2], ARGV[3])
            return 1
            "#,
        );
        let _: i32 = script
            .key(receipt_key)
            .key(digest_key)
            .key(pending_users_key)
            .arg(serialized)
            .arg(send_at)
            .arg(user_id_str)
            .invoke_async(&mut conn)
            .await?;

        Ok(())
    }

    async fn remove_notification_receipt(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: uuid::Uuid,
        delivery_generation: uuid::Uuid,
    ) -> Result<(), Report> {
        let mut conn = self.conn.clone();
        conn.del::<_, ()>(self.receipt_key(user_id.as_ref(), notification_id, delivery_generation))
            .await?;
        Ok(())
    }

    async fn claim_ready_digest(&self) -> Result<ClaimResult<DigestBatch>, Report> {
        let mut conn = self.conn.clone();
        let now = Utc::now().timestamp();
        let pending_users_key = self.pending_users_key();

        // Step 1: Atomically pop one user from the pending set
        // Only one worker will receive this user
        let result: Vec<(String, f64)> = conn.zpopmin(&pending_users_key, 1).await?;

        let Some((user_id_str, score)) = result.into_iter().next() else {
            return Ok(ClaimResult::Empty);
        };

        // Check if this digest is actually ready to send
        if score > now as f64 {
            // Not ready yet, put it back
            conn.zadd::<_, _, _, ()>(&pending_users_key, &user_id_str, score)
                .await?;

            // Return how long to wait until this digest is ready
            let wait_secs = (score as i64) - now;
            return Ok(ClaimResult::Wait(Duration::from_secs(wait_secs as u64)));
        }

        // Discard stale digests older than 48 hours to avoid sending a backlog
        // of accumulated notifications (e.g. after removing the macro.com domain gate)
        const STALENESS_THRESHOLD: Duration = Duration::from_hours(48);
        let age_secs = now - score as i64;
        if age_secs > STALENESS_THRESHOLD.as_secs() as i64 {
            let digest_key = self.digest_key(&user_id_str);
            conn.del::<_, ()>(&digest_key).await?;
            tracing::warn!(
                user_id = %user_id_str,
                age_hours = age_secs / 3600,
                "Discarding stale email digest older than 48 hours"
            );
            return Ok(ClaimResult::Empty);
        }

        let digest_key = self.digest_key(&user_id_str);
        let processing_key = self.processing_key(&user_id_str);

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

        let notifications: Vec<_> = items
            .into_iter()
            .filter_map(|s| {
                serde_json::from_str::<UserNotificationRow<serde_json::Value>>(&s)
                    .inspect_err(|e| tracing::error!(error=?e, payload_length=s.len(), "failed to deserialize digest notification"))
                    .ok()
                    .map(|n| n.into_tagged())
            })
            .collect();

        if notifications.is_empty() {
            return Ok(ClaimResult::Empty);
        }

        Ok(ClaimResult::Ready(DigestBatch {
            user_id,
            notifications,
        }))
    }
}
