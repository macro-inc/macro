use crate::MacroCache;

/// Rate limit expiry for create user hourly
pub static MACRO_CREATE_USER_HOURLY_EXPIRY_SECONDS: i64 = 60 * 60; // 1 hour in seconds

/// Generates the rate limit key for creating user for a given ip
macro_rules! macro_create_user_rate_limit_hourly {
    ($ip:expr) => {
        format!("rtl_create_user_hourly:{}", $ip)
    };
}

impl MacroCache {
    /// Gets the create user hourly rate limit for a given ip
    pub async fn get_create_user_hourly_rate_limit(&self, ip: &str) -> anyhow::Result<Option<u64>> {
        let key = macro_create_user_rate_limit_hourly!(ip);
        macro_redis::get::get_optional::<u64>(&self.inner, &key).await
    }

    /// Increments the create user hourly rate limit for a given ip
    pub async fn increment_create_user_hourly_rate_limit(&self, ip: &str) -> anyhow::Result<()> {
        let key = macro_create_user_rate_limit_hourly!(ip);
        macro_redis::incr::incr_with_expiry(
            &self.inner,
            &key,
            MACRO_CREATE_USER_HOURLY_EXPIRY_SECONDS,
        )
        .await
    }
}
