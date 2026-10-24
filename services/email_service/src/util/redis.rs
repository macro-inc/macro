pub mod access_token;
pub mod backfill;
pub mod health_probe;
pub mod lock;
pub mod rate_limit;

#[derive(Clone)]
pub struct RedisClient {
    pub inner: redis::Client,

    /// Duration of the sliding window for Google Calendar rate limiting in seconds.
    pub rate_limit_secs: u32,
}

impl RedisClient {
    pub fn new(inner: redis::Client, rate_limit_secs: u32) -> Self {
        Self {
            inner,
            rate_limit_secs,
        }
    }
}
