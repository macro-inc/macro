//! Cross-instance cancellation signalling for in-flight AI chat streams.
//!
//! DCS runs as multiple replicas. A stop request can land on any instance,
//! not necessarily the one running the stream. We signal cancellation over
//! Redis pub/sub on a per-`stream_id` channel: the instance running the
//! stream subscribes at start, any instance can publish a cancel, and the
//! running task sees the message and fires its local `CancellationToken`.
//!
//! The token's lifetime is tied to `CancellationSubscription` — drop it and
//! the background subscriber task is aborted.

use anyhow::Context;
use futures::StreamExt;
use redis::{AsyncCommands, Client};
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const CANCEL_CHANNEL_PREFIX: &str = "ai_stream_cancel:";
/// Max time we'll wait for the subscription to become live before returning
/// from `register`. If we time out we still return a (non-firing) token so
/// the stream isn't blocked by a flaky Redis.
const SUBSCRIBE_READY_TIMEOUT: Duration = Duration::from_secs(1);

fn channel_for(stream_id: &str) -> String {
    format!("{CANCEL_CHANNEL_PREFIX}{stream_id}")
}

/// Publishes and subscribes cancellation signals to Redis pub/sub. Cheap to
/// clone — the Redis client is already shared.
#[derive(Clone)]
pub struct AiStreamRegistry {
    redis: Arc<Client>,
}

/// Subscription handle kept alive for the lifetime of a streaming task.
/// The held `token` fires when a cancellation is published. Dropping the
/// subscription aborts the background subscriber task.
pub struct CancellationSubscription {
    pub token: CancellationToken,
    task: JoinHandle<()>,
}

impl Drop for CancellationSubscription {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl AiStreamRegistry {
    /// Construct a new registry backed by the given Redis client.
    pub fn new(redis: Arc<Client>) -> Self {
        Self { redis }
    }

    /// Subscribe to cancel events for `stream_id`. The returned
    /// [`CancellationSubscription`] must be held for the lifetime of the
    /// stream; dropping it unsubscribes. The inner token fires when any
    /// instance publishes a cancel.
    ///
    /// This is a best-effort registration: if Redis is unreachable we log
    /// and return a token that will never fire, so the stream still runs
    /// (it just can't be stopped remotely).
    pub async fn register(&self, stream_id: String) -> CancellationSubscription {
        let token = CancellationToken::new();
        let client = self.redis.clone();
        let task_token = token.clone();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();

        let task = tokio::spawn(async move {
            let channel = channel_for(&stream_id);
            let mut pubsub = match client.get_async_pubsub().await {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!(error=?e, stream_id=%stream_id, "failed to connect pubsub for ai_stream_cancel");
                    return;
                }
            };
            if let Err(e) = pubsub.subscribe(&channel).await {
                tracing::error!(error=?e, stream_id=%stream_id, "failed to subscribe to ai_stream_cancel channel");
                return;
            }
            // Signal readiness *after* subscribe() completes, so a publish
            // racing us on another instance won't be missed.
            let _ = ready_tx.send(());

            let mut msgs = pubsub.on_message();
            if msgs.next().await.is_some() {
                tracing::info!(stream_id=%stream_id, "received cancellation signal");
                task_token.cancel();
            }
        });

        // Wait for the subscribe() to land on Redis. If it times out we still
        // hand back a token — it just won't fire.
        if tokio::time::timeout(SUBSCRIBE_READY_TIMEOUT, ready_rx)
            .await
            .is_err()
        {
            tracing::warn!(
                "ai_stream_cancel subscribe did not become ready within {SUBSCRIBE_READY_TIMEOUT:?}"
            );
        }

        CancellationSubscription { token, task }
    }

    /// Publish a cancel request for `stream_id`. Returns the number of
    /// subscribers that received the message — 0 means the stream has
    /// already finished or was on an instance that's no longer running.
    pub async fn cancel(&self, stream_id: &str) -> anyhow::Result<u32> {
        let mut conn = self
            .redis
            .get_multiplexed_async_connection()
            .await
            .context("failed to get redis connection for ai_stream_cancel publish")?;
        let n: u32 = conn
            .publish(channel_for(stream_id), "1")
            .await
            .context("failed to publish ai_stream_cancel")?;
        Ok(n)
    }
}
