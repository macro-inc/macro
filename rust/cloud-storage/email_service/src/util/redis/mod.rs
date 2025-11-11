pub mod access_token;
pub mod backfill;
pub mod rate_limit;

#[derive(Clone)]
pub struct RedisClient {
    pub inner: redis::Client,

    /// Maximum allowed Gmail API quota units within the rate limiting window.
    /// Gmail API per-user quota is 15,000 units per minute.
    pub rate_limit_units: u32,

    /// Duration of the sliding window for Gmail API rate limiting in seconds.
    /// Uses a 60-second window to align with Gmail's per-minute quota period.
    pub rate_limit_secs: u32,
}

impl RedisClient {
    pub fn new(inner: redis::Client, rate_limit_units: u32, rate_limit_secs: u32) -> Self {
        Self {
            inner,
            rate_limit_units,
            rate_limit_secs,
        }
    }
}
