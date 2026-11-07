//! Shared admission for every Graph request, including nested pagination.

use email_api_client_core::{
    models::{EmailApiError, GateLimit, MailboxAccess, RateLimitOrigin},
    ports::MailboxRequestGate,
};
use redis::aio::MultiplexedConnection;
use std::{future::Future, pin::Pin, time::Duration};
use uuid::Uuid;

#[cfg(test)]
mod test;

// Graph permits 10,000 requests/10 minutes and four concurrent requests per
// app/mailbox. Leave headroom for consent-time discovery and provider accounting.
// https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits
const REQUESTS_PER_WINDOW: u32 = 9_000;
const CONCURRENT_REQUESTS: u32 = 3;
const WINDOW_MS: u32 = 600_000;
// Greater than the Graph transport's 60-second total request timeout.
const PERMIT_MS: u32 = 90_000;
// Admitted requests are counted per sync generation for import statistics.
// Long enough to outlast any import.
const REQUEST_COUNT_MS: u64 = 30 * 24 * 3_600_000;

// Returns `{limit, delay_ms}`: limit 0 admits the request, otherwise it names
// the refusing limit (1 cooldown, 2 concurrency, 3 window).
const ACQUIRE: &str = r#"
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local cooldown = redis.call('PTTL', KEYS[3])
if cooldown > 0 then return {1, cooldown} end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - tonumber(ARGV[4]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
    local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    return {2, math.max(1, tonumber(first[2]) - now)}
end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then
    local first = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    return {3, math.max(1, tonumber(first[2]) + tonumber(ARGV[4]) - now)}
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[5]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('ZADD', KEYS[2], now, ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
redis.call('HINCRBY', KEYS[4], ARGV[6], 1)
redis.call('PEXPIRE', KEYS[4], ARGV[7])
return {0, 0}
"#;

const FINISH: &str = r#"
redis.call('ZREM', KEYS[1], ARGV[1])
local delay = tonumber(ARGV[2])
if delay > 0 and redis.call('PTTL', KEYS[2]) < delay then
    redis.call('SET', KEYS[2], '1', 'PX', delay)
end
return 1
"#;

/// Redis admission shared by all Microsoft mail and calendar callers.
#[derive(Clone)]
pub struct RedisMicrosoftRequestGate(pub MultiplexedConnection);

fn keys(mailbox: MailboxAccess) -> [String; 4] {
    // Hash tags colocate the Lua keys in Redis Cluster. Generations share the
    // quota: refreshing or reconnecting must not reset Microsoft's allowance.
    let scope = format!("outlook:{{{}}}", mailbox.link_id);
    [
        format!("{scope}:inflight"),
        format!("{scope}:window"),
        format!("{scope}:cooldown"),
        format!("{scope}:requests"),
    ]
}

impl MailboxRequestGate for RedisMicrosoftRequestGate {
    fn acquire(
        &self,
        mailbox: MailboxAccess,
    ) -> Pin<Box<dyn Future<Output = Result<Uuid, EmailApiError>> + Send + '_>> {
        Box::pin(async move {
            let permit = Uuid::now_v7();
            let [inflight, window, cooldown, requests] = keys(mailbox);
            let (limit, delay): (u8, u64) = redis::Script::new(ACQUIRE)
                .key(inflight)
                .key(window)
                .key(cooldown)
                .key(requests)
                .arg(permit.to_string())
                .arg(CONCURRENT_REQUESTS)
                .arg(REQUESTS_PER_WINDOW)
                .arg(WINDOW_MS)
                .arg(PERMIT_MS)
                .arg(mailbox.sync_generation)
                .arg(REQUEST_COUNT_MS)
                .invoke_async(&mut self.0.clone())
                .await
                .map_err(|_| EmailApiError::Transient {
                    message: "Microsoft request admission is unavailable".into(),
                })?;
            let limit = match limit {
                0 => return Ok(permit),
                1 => GateLimit::Cooldown,
                2 => GateLimit::Concurrency,
                _ => GateLimit::Window,
            };
            Err(EmailApiError::RateLimited {
                retry_after: Some(Duration::from_millis(delay)),
                origin: RateLimitOrigin::Gate(limit),
            })
        })
    }
    fn finish(
        &self,
        mailbox: MailboxAccess,
        permit: Uuid,
        retry_after: Option<Duration>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let [inflight, _, cooldown, _] = keys(mailbox);
            let delay = retry_after
                .map(|delay| delay.as_millis().clamp(1, 86_400_000) as u64)
                .unwrap_or(0);
            let result: redis::RedisResult<i32> = redis::Script::new(FINISH)
                .key(inflight)
                .key(cooldown)
                .arg(permit.to_string())
                .arg(delay)
                .invoke_async(&mut self.0.clone())
                .await;
            if result.is_err() {
                // A completed provider write must retain its known outcome even
                // when releasing admission fails. The crash lease will expire.
                tracing::warn!(link_id=%mailbox.link_id,"failed to finish Microsoft request admission");
            }
        })
    }
    fn admitted(
        &self,
        mailbox: MailboxAccess,
    ) -> Pin<Box<dyn Future<Output = Option<u64>> + Send + '_>> {
        Box::pin(async move {
            let [.., requests] = keys(mailbox);
            let admitted: redis::RedisResult<Option<u64>> = redis::cmd("HGET")
                .arg(requests)
                .arg(mailbox.sync_generation)
                .query_async(&mut self.0.clone())
                .await;
            admitted
                .inspect_err(|error| {
                    tracing::warn!(link_id = %mailbox.link_id, %error, "failed to read admitted Microsoft requests");
                })
                .ok()
                .flatten()
        })
    }
}
