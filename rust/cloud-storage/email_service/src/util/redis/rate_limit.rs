use crate::util::redis::RedisClient;
use models_email::gmail::operations::GmailApiOperation;
use redis::Script;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

impl RedisClient {
    /// Checks if a Gmail API operation is rate-limited and returns the status.
    /// Uses a 60-second sliding window implemented via a Lua script for efficiency and atomicity.
    /// Using a Lua script provides several benefits: simpler logic compared to raw Redis commands, connection pooling
    /// via async multiplexed connections rather than dedicated connections, reduced network round trips,
    /// and guaranteed atomic execution. If anything goes wrong, return false and hope for the best
    ///
    /// # Arguments
    /// * `user_id` - UUID of the user to check rate limiting for
    /// * `operation` - The Gmail API operation to check rate limiting for
    ///
    /// # Returns
    /// Returns `true` if the operation should be rate limited (blocked), `false` otherwise.
    ///
    pub async fn is_rate_limited(&self, user_id: Uuid, operation: GmailApiOperation) -> bool {
        let cost = operation.cost();
        let mut con = match self.inner.get_multiplexed_async_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                tracing::warn!(
                    "Failed to get Redis connection for rate limiting user_id {}: {}",
                    user_id,
                    e
                );
                return false;
            }
        };

        let lua_script = get_rate_limit_script_with_usage();

        let redis_key = format!("gmail-ratelimit:log:{}", user_id);
        let now_micros = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_micros() as u64;
        let member_id = format!("{}:{}", cost, Uuid::new_v4());

        let script = Script::new(lua_script);

        let (is_limited, _current_units): (i32, u32) = match script
            .key(&redis_key)
            .arg(self.rate_limit_units)
            .arg(self.rate_limit_secs * 1_000_000)
            .arg(now_micros)
            .arg(cost)
            .arg(&member_id)
            .invoke_async(&mut con)
            .await
        {
            Ok(res) => res,
            Err(e) => {
                tracing::warn!(
                    "Failed to execute rate limit script for user_id {}: {}",
                    user_id.to_string(),
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
/// The script is designed to be executed atomically on the Redis server. It tracks the
/// cumulative cost (quota units) of requests within a sliding time window and returns
/// both the rate limit decision and the current usage.
///
/// # Script Arguments:
/// - `KEYS[1]`: The unique key for the user's request log (a sorted set).
/// - `ARGV[1]`: The maximum number of quota units allowed in the window (the limit).
/// - `ARGV[2]`: The time window duration in microseconds.
/// - `ARGV[3]`: The current time in microseconds, used as the score for the new request.
/// - `ARGV[4]`: The quota unit cost of the current request.
/// - `ARGV[5]`: A unique member for the current request, formatted as "cost:uuid".
///
/// # Script Returns:
/// A Lua table (interpreted as a tuple in Rust) containing two integers: `[is_limited, unit_count]`.
///
/// - **`is_limited` (Index 1):**
///   - `1` if the request is denied (rate-limited).
///   - `0` if the request is allowed.
///
/// - **`unit_count` (Index 2):** The total quota units in the window. The value is context-dependent:
///   - If the request was **allowed**, this is the new total *including* the current request's cost.
///   - If the request was **denied**, this is the total *excluding* the current request's cost.
///
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
