//! Redis-based concurrency limit adapter.
//!
//! Each key is a sorted set of holders scored by the unix milliseconds their
//! lease lapses at. Acquiring first drops lapsed holders, so a holder that
//! died without releasing stops counting once its lease lapses. Times come
//! from the Redis server clock, so holders on different hosts agree.

#[cfg(test)]
mod test;

use rootcause::Report;

use crate::domain::models::{ConcurrencyLease, ConcurrencyLimitConfig, RateLimitKey};
use crate::domain::ports::ConcurrencyLimitPort;

/// Redis key prefix for concurrency lease sets.
const KEY_PREFIX: &str = "rtc";

/// Acquire or renew a lease. Returns `{held, live_leases}`.
///
/// Every write sets the key's expiry to one lease from now, which is at or
/// after every member's own lapse time because all leases on a key share one
/// length, so an idle key disappears on its own.
const ACQUIRE_SCRIPT: &str = r"
local key = KEYS[1]
local holder = ARGV[1]
local max_holders = tonumber(ARGV[2])
local lease_ms = tonumber(ARGV[3])
local time = redis.call('TIME')
local now_ms = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms)
local live = redis.call('ZCARD', key)
if not redis.call('ZSCORE', key, holder) then
  if live >= max_holders then
    return {0, live}
  end
  live = live + 1
end
redis.call('ZADD', key, now_ms + lease_ms, holder)
redis.call('PEXPIRE', key, lease_ms)
return {1, live}
";

fn redis_key(key: &RateLimitKey) -> String {
    format!("{KEY_PREFIX}:{}", key.to_hex_string())
}

/// Redis implementation of [`ConcurrencyLimitPort`].
#[derive(Clone)]
pub struct RedisConcurrencyLimitAdapter {
    /// The Redis client.
    pub redis: redis::Client,
}

impl ConcurrencyLimitPort for RedisConcurrencyLimitAdapter {
    #[tracing::instrument(err, skip(self, key))]
    async fn acquire(
        &self,
        key: &RateLimitKey,
        holder: &str,
        config: ConcurrencyLimitConfig,
    ) -> Result<ConcurrencyLease, Report> {
        let mut connection = self.redis.get_multiplexed_async_connection().await?;
        let lease_ms = u64::try_from(config.lease.as_millis()).unwrap_or(u64::MAX);
        let (held, live): (i64, i64) = redis::Script::new(ACQUIRE_SCRIPT)
            .key(redis_key(key))
            .arg(holder)
            .arg(config.max_holders)
            .arg(lease_ms)
            .invoke_async(&mut connection)
            .await?;

        if held == 1 {
            return Ok(ConcurrencyLease::Held);
        }
        Ok(ConcurrencyLease::Exceeded {
            current: u64::try_from(live).unwrap_or_default(),
            max_holders: config.max_holders,
        })
    }

    #[tracing::instrument(err, skip(self, key))]
    async fn release(&self, key: &RateLimitKey, holder: &str) -> Result<(), Report> {
        let mut connection = self.redis.get_multiplexed_async_connection().await?;
        let _: i64 = redis::cmd("ZREM")
            .arg(redis_key(key))
            .arg(holder)
            .query_async(&mut connection)
            .await?;
        Ok(())
    }
}
