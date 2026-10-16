//! Shared admission for every Graph request, including nested pagination.

use crate::domain::{
    models::{EmailApiError, MailboxAccess, RateLimitOrigin},
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

const ACQUIRE: &str = r#"
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local cooldown = redis.call('PTTL', KEYS[3])
if cooldown > 0 then return cooldown end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - tonumber(ARGV[4]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
    local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    return math.max(1, tonumber(first[2]) - now)
end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then
    local first = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    return math.max(1, tonumber(first[2]) + tonumber(ARGV[4]) - now)
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[5]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('ZADD', KEYS[2], now, ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 0
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

fn keys(mailbox: MailboxAccess) -> [String; 3] {
    // Hash tags colocate the Lua keys in Redis Cluster. Generations share the
    // quota: refreshing or reconnecting must not reset Microsoft's allowance.
    let scope = format!("outlook:{{{}}}", mailbox.link_id);
    [
        format!("{scope}:inflight"),
        format!("{scope}:window"),
        format!("{scope}:cooldown"),
    ]
}

impl MailboxRequestGate for RedisMicrosoftRequestGate {
    fn acquire(
        &self,
        mailbox: MailboxAccess,
    ) -> Pin<Box<dyn Future<Output = Result<Uuid, EmailApiError>> + Send + '_>> {
        Box::pin(async move {
            let permit = Uuid::now_v7();
            let [inflight, window, cooldown] = keys(mailbox);
            let delay: u64 = redis::Script::new(ACQUIRE)
                .key(inflight)
                .key(window)
                .key(cooldown)
                .arg(permit.to_string())
                .arg(CONCURRENT_REQUESTS)
                .arg(REQUESTS_PER_WINDOW)
                .arg(WINDOW_MS)
                .arg(PERMIT_MS)
                .invoke_async(&mut self.0.clone())
                .await
                .map_err(|_| EmailApiError::Transient {
                    message: "Microsoft request admission is unavailable".into(),
                })?;
            if delay > 0 {
                return Err(EmailApiError::RateLimited {
                    retry_after: Some(Duration::from_millis(delay)),
                    origin: RateLimitOrigin::Local,
                });
            }
            Ok(permit)
        })
    }
    fn finish(
        &self,
        mailbox: MailboxAccess,
        permit: Uuid,
        retry_after: Option<Duration>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let [inflight, _, cooldown] = keys(mailbox);
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
}
