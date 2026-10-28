//! Redis-backed Google Calendar API quota gate.

use redis::Script;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Flat Google Calendar per-inbox query budget for the sliding window.
const CALENDAR_RATE_LIMIT_QUERIES: u32 = 300;

/// Redis client holding the sliding-window parameters for calendar rate limiting.
#[derive(Clone)]
pub struct CalendarRateLimiter {
    inner: redis::Client,
    /// Duration of the sliding window in seconds.
    window_secs: u32,
}

impl CalendarRateLimiter {
    /// Construct the limiter over a Redis client and window duration.
    pub fn new(inner: redis::Client, window_secs: u32) -> Self {
        Self { inner, window_secs }
    }

    /// Checks if a Google Calendar API request is rate-limited, using an
    /// atomic sliding-window Lua script with a calendar-specific key and
    /// Calendar's flat one-query-per-request cost.
    pub async fn is_calendar_rate_limited(&self, email_link_id: Uuid) -> bool {
        let mut con = match self.inner.get_multiplexed_async_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                tracing::warn!(
                    "Failed to get Redis connection for calendar rate limiting link {}: {}",
                    email_link_id,
                    e
                );
                return false;
            }
        };

        let redis_key = format!("calendar-ratelimit:log:{}", email_link_id);
        let now_micros = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_micros() as u64;
        let cost = 1u32;
        let member_id = format!("{}:{}", cost, Uuid::new_v4());
        let script = Script::new(get_rate_limit_script_with_usage());

        let (is_limited, _current_units): (i32, u32) = match script
            .key(&redis_key)
            .arg(CALENDAR_RATE_LIMIT_QUERIES)
            .arg(self.window_secs * 1_000_000)
            .arg(now_micros)
            .arg(cost)
            .arg(&member_id)
            .invoke_async(&mut con)
            .await
        {
            Ok(res) => res,
            Err(e) => {
                tracing::warn!(
                    "Failed to execute calendar rate limit script for link {}: {}",
                    email_link_id,
                    e
                );
                return false;
            }
        };

        is_limited == 1
    }
}

/// Returns the raw Lua script for an atomic, cost-based sliding window rate limiter.
///
/// The script is executed atomically on the Redis server. It tracks the
/// cumulative cost (quota units) of requests within a sliding time window and
/// returns both the rate limit decision and the current usage.
fn get_rate_limit_script_with_usage() -> &'static str {
    r#"
        local key = KEYS[1]
        local limit_units = tonumber(ARGV[1])
        local window_micros = tonumber(ARGV[2])
        local now_micros = tonumber(ARGV[3])
        local new_request_units = tonumber(ARGV[4])
        local new_member = ARGV[5]

        local window_start = now_micros - window_micros

        -- Step 1: Cleanup old entries
        redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

        -- Step 2: Calculate current usage
        local members = redis.call('ZRANGE', key, 0, -1)
        local current_units = 0
        for _, member in ipairs(members) do
            local cost = tonumber(string.match(member, "^(%d+):"))
            if cost then
                current_units = current_units + cost
            end
        end

        -- Step 3: Check limit and return a table with [is_limited, unit_count]
        if (current_units + new_request_units) > limit_units then
            -- DENIED: Return 1 and the current unit count (without adding the new request)
            return {1, current_units}
        else
            -- ALLOWED: Add the new request...
            redis.call('ZADD', key, now_micros, new_member)
            redis.call('EXPIRE', key, (window_micros / 1000000) * 2)

            -- ...and return 0 with the new total unit count
            local new_total = current_units + new_request_units
            return {0, new_total}
        end
    "#
}
