//! Redis-based rate limit adapter.

#[cfg(test)]
mod test;

use rootcause::Report;

use crate::domain::models::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitOk, RateLimitResult,
};
use crate::domain::ports::RateLimitPort;

/// Redis key prefix for rate limit counters.
const KEY_PREFIX: &str = "rtl";

/// Format a [`RateLimitKey`] into the Redis key string used for storage.
fn redis_key(key: &RateLimitKey) -> String {
    format!("{KEY_PREFIX}:{}", key.to_hex_string())
}

/// Redis-based implementation of the rate limit port.
///
/// This adapter uses Redis to store and check rate limit counters.
/// The key is provided by the caller (already hashed), and this adapter
/// handles the Redis operations.
#[derive(Clone)]
pub struct RedisRateLimitAdapter<R> {
    /// the inner redis client
    pub redis: R,
}

/// Trait for Redis operations needed by the rate limit adapter.
///
/// This allows the adapter to work with different Redis client implementations.
pub trait RedisRateLimitOps {
    /// Atomically check the rate limit and increment if allowed.
    ///
    /// Uses a Lua script to avoid TOCTOU races between reading the count and
    /// incrementing. Returns `(allowed, current_count, ttl_seconds_if_denied)`.
    fn check_and_increment(
        &self,
        key: &str,
        max_count: u64,
        expiry_seconds: u64,
    ) -> impl std::future::Future<Output = Result<(bool, u64, Option<u64>), Report>> + Send;

    /// Decrement the counter for a key, flooring at zero.
    fn decrement(&self, key: &str) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl RedisRateLimitOps for redis::Client {
    async fn check_and_increment(
        &self,
        key: &str,
        max_count: u64,
        expiry_seconds: u64,
    ) -> Result<(bool, u64, Option<u64>), Report> {
        let mut conn = self.get_multiplexed_async_connection().await?;

        let script = redis::Script::new(
            r"
            local key = KEYS[1]
            local max_count = tonumber(ARGV[1])
            local window = tonumber(ARGV[2])
            local current = tonumber(redis.call('GET', key) or '0')
            if current >= max_count then
                local ttl = redis.call('TTL', key)
                if ttl < 0 then ttl = 0 end
                return {0, current, ttl}
            end
            local new_count = redis.call('INCR', key)
            if new_count == 1 then
                redis.call('EXPIRE', key, window)
            end
            return {1, new_count, 0}
            ",
        );

        let (allowed, count, ttl): (i64, i64, i64) = script
            .key(key)
            .arg(max_count)
            .arg(expiry_seconds)
            .invoke_async(&mut conn)
            .await?;

        let ttl = if ttl > 0 { Some(ttl as u64) } else { None };
        Ok((allowed == 1, count as u64, ttl))
    }

    async fn decrement(&self, key: &str) -> Result<(), Report> {
        let mut conn = self.get_multiplexed_async_connection().await?;

        // DECR but floor at 0 to avoid negative counts
        let script = redis::Script::new(
            r"
            local key = KEYS[1]
            local current = tonumber(redis.call('GET', key) or '0')
            if current > 0 then
                redis.call('DECR', key)
            end
            return 0
            ",
        );

        script.key(key).invoke_async::<i64>(&mut conn).await?;

        Ok(())
    }
}

impl<R: RedisRateLimitOps + Send + Sync + 'static> RateLimitPort for RedisRateLimitAdapter<R> {
    async fn check(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        let key_str = redis_key(&key);

        let (allowed, current_count, ttl) = self
            .redis
            .check_and_increment(&key_str, config.max_count, config.window.as_secs())
            .await?;

        if allowed {
            Ok(RateLimitResult::Ok(RateLimitOk {
                current_count,
                key,
                config,
            }))
        } else {
            let retry_after =
                std::time::Duration::from_secs(ttl.unwrap_or(config.window.as_secs()));
            Ok(RateLimitResult::Err(RateLimitExceeded {
                current_count,
                max_count: config.max_count,
                retry_after,
            }))
        }
    }

    async fn decrement(&self, key: &RateLimitKey) -> Result<(), Report> {
        let key_str = redis_key(key);
        self.redis.decrement(&key_str).await
    }
}
