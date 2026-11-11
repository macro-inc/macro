//! In-memory token bucket per repo. Per process: run one task, or move the
//! buckets to Redis before scaling out.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;
use tokio::time::Instant;

use crate::domain::ports::PushRateLimiter;

const WINDOW: Duration = Duration::from_secs(60);

struct Bucket {
    tokens: f64,
    refilled_at: Instant,
}

/// Allows `pushes_per_minute` pushes per repo, refilling continuously.
pub struct InMemoryPushRateLimiter {
    pushes_per_minute: u32,
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl InMemoryPushRateLimiter {
    /// A limiter with a full bucket for every repo.
    pub fn new(pushes_per_minute: u32) -> Self {
        Self {
            pushes_per_minute,
            buckets: Mutex::new(HashMap::new()),
        }
    }
}

impl PushRateLimiter for InMemoryPushRateLimiter {
    fn try_acquire_push(&self, agent_user_id: &MacroUserIdStr<'_>) -> bool {
        let capacity = f64::from(self.pushes_per_minute);
        let now = Instant::now();
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let bucket = buckets
            .entry(agent_user_id.as_ref().to_owned())
            .or_insert(Bucket {
                tokens: capacity,
                refilled_at: now,
            });

        let elapsed = now.duration_since(bucket.refilled_at).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * capacity / WINDOW.as_secs_f64()).min(capacity);
        bucket.refilled_at = now;

        if bucket.tokens < 1.0 {
            return false;
        }

        bucket.tokens -= 1.0;
        true
    }
}

#[cfg(test)]
mod test;
