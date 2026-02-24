//! Redis-based rate limit adapter.

use redis::AsyncCommands;
use rootcause::Report;

use crate::domain::models::{RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult};
use crate::domain::ports::RateLimitPort;

/// Redis-based implementation of the rate limit port.
///
/// This adapter uses Redis to store and check rate limit counters.
/// The key is provided by the caller (already hashed), and this adapter
/// handles the Redis operations.
pub struct RedisRateLimitAdapter<R> {
    redis: R,
}

impl<R> RedisRateLimitAdapter<R> {
    /// Create a new Redis rate limit adapter.
    pub fn new(redis: R) -> Self {
        Self { redis }
    }
}

/// Trait for Redis operations needed by the rate limit adapter.
///
/// This allows the adapter to work with different Redis client implementations.
pub trait RedisRateLimitOps {
    /// Get the current count for a key.
    fn get_count(
        &self,
        key: &str,
    ) -> impl std::future::Future<Output = Result<Option<u64>, Report>> + Send;

    /// Increment a key and set expiry if it's new.
    fn increment_with_expiry(
        &self,
        key: &str,
        expiry_seconds: u64,
    ) -> impl std::future::Future<Output = Result<u64, Report>> + Send;
}

impl RedisRateLimitOps for redis::Client {
    async fn get_count(&self, key: &str) -> Result<Option<u64>, Report> {
        let mut conn = self.get_multiplexed_async_connection().await?;
        let count: Option<u64> = conn.get(key).await?;
        Ok(count)
    }

    async fn increment_with_expiry(&self, key: &str, expiry_seconds: u64) -> Result<u64, Report> {
        let mut conn = self.get_multiplexed_async_connection().await?;

        // Use atomic pipeline: INCR + EXPIRE
        let (new_count,): (u64,) = redis::pipe()
            .atomic()
            .incr(key, 1u64)
            .expire(key, expiry_seconds as i64)
            .ignore()
            .query_async(&mut conn)
            .await?;

        Ok(new_count)
    }
}

impl<R: RedisRateLimitOps + Send + Sync + 'static> RateLimitPort for RedisRateLimitAdapter<R> {
    async fn check_and_increment(
        &self,
        key: &RateLimitKey,
        config: &RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        let key_str = format!("rtl:{}", key.to_hex_string());
        let expiry_seconds = config.window.as_secs();

        // Get current count
        let current_count = self.redis.get_count(&key_str).await?.unwrap_or(0);

        // Check if already exceeded
        if current_count >= config.max_count {
            return Ok(RateLimitResult::Exceeded(RateLimitExceeded {
                key: key_str,
                current_count,
                max_count: config.max_count,
            }));
        }

        // Increment and set expiry
        let new_count = self
            .redis
            .increment_with_expiry(&key_str, expiry_seconds)
            .await?;

        // Check again after increment (in case of race condition)
        if new_count > config.max_count {
            Ok(RateLimitResult::Exceeded(RateLimitExceeded {
                key: key_str,
                current_count: new_count,
                max_count: config.max_count,
            }))
        } else {
            Ok(RateLimitResult::Allowed {
                current_count: new_count,
            })
        }
    }
}
