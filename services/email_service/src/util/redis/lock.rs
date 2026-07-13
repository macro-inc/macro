use crate::util::redis::RedisClient;
use std::time::Duration;
use uuid::Uuid;

/// A distributed lock backed by Redis using SET NX EX.
///
/// Prefer calling [`RedisLock::release`] explicitly for deterministic cleanup.
/// If not released explicitly, the lock is released on a best-effort basis via `Drop`
/// (spawns a tokio task). The Redis TTL acts as the ultimate safety net if both fail.
pub struct RedisLock {
    /// `None` after an explicit `release()` call, so `Drop` becomes a no-op.
    inner: Option<RedisLockInner>,
}

struct RedisLockInner {
    client: redis::Client,
    key: String,
    token: String,
}

impl RedisLockInner {
    /// Release the lock atomically: only delete if the token still matches.
    /// This prevents releasing a lock that was already expired and acquired by someone else.
    async fn release(&self) {
        let script = redis::Script::new(
            r#"
            if redis.call('GET', KEYS[1]) == ARGV[1] then
                return redis.call('DEL', KEYS[1])
            else
                return 0
            end
            "#,
        );

        let result: Result<(), _> = async {
            let mut con = self.client.get_multiplexed_async_connection().await?;
            script
                .key(&self.key)
                .arg(&self.token)
                .invoke_async(&mut con)
                .await
        }
        .await;

        if let Err(e) = result {
            tracing::warn!(key = %self.key, error = %e, "failed to release redis lock");
        }
    }
}

impl RedisLock {
    /// Explicitly release the lock. Preferred over relying on Drop.
    pub async fn release(mut self) {
        if let Some(inner) = self.inner.take() {
            inner.release().await;
        }
    }
}

impl Drop for RedisLock {
    fn drop(&mut self) {
        if let Some(inner) = self.inner.take() {
            // Best-effort: spawn a task to release. If the runtime is shutting down
            // or we're outside a runtime, the TTL will expire the lock.
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.spawn(async move {
                    inner.release().await;
                });
            } else {
                tracing::warn!(
                    key = %inner.key,
                    "redis lock dropped outside tokio runtime, will expire via TTL"
                );
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LockError {
    #[error("failed to acquire lock: already held")]
    AlreadyHeld,

    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
}

impl RedisClient {
    /// Attempts to acquire a distributed lock with the given key and TTL.
    ///
    /// Uses `SET key token NX EX ttl` for atomic acquire. The returned `RedisLock`
    /// releases the lock on drop (or preferably via explicit `release()`).
    ///
    /// Returns `Err(LockError::AlreadyHeld)` if the lock is already held by another caller.
    pub async fn try_acquire_lock(&self, key: &str, ttl: Duration) -> Result<RedisLock, LockError> {
        let token = Uuid::new_v4().to_string();
        let mut con = self.inner.get_multiplexed_async_connection().await?;

        let result: Option<String> = redis::cmd("SET")
            .arg(key)
            .arg(&token)
            .arg("NX")
            .arg("EX")
            .arg(ttl.as_secs())
            .query_async(&mut con)
            .await?;

        match result {
            Some(_) => Ok(RedisLock {
                inner: Some(RedisLockInner {
                    client: self.inner.clone(),
                    key: key.to_string(),
                    token,
                }),
            }),
            None => Err(LockError::AlreadyHeld),
        }
    }

    /// Acquires a distributed lock, retrying until the timeout is reached.
    ///
    /// - `ttl`: How long the lock lives in Redis. Must be longer than the expected work duration.
    ///   If the lock expires before work completes, another caller can acquire it.
    /// - `timeout`: How long to wait for the lock to become available before giving up.
    ///
    /// Polls every 100ms. Returns `Err(LockError::AlreadyHeld)` if the lock cannot be
    /// acquired within `timeout`.
    pub async fn acquire_lock(
        &self,
        key: &str,
        ttl: Duration,
        timeout: Duration,
    ) -> Result<RedisLock, LockError> {
        let start = std::time::Instant::now();
        loop {
            match self.try_acquire_lock(key, ttl).await {
                Ok(lock) => return Ok(lock),
                Err(LockError::AlreadyHeld) if start.elapsed() < timeout => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Err(e) => return Err(e),
            }
        }
    }
}
