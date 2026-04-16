use crate::MacroCache;

macro_rules! mobile_welcome_email_rate_limit {
    ($ip:expr) => {
        format!("rtl_mobile_welcome_email:{}", $ip)
    };
}

impl MacroCache {
    /// Gets the mobile welcome email rate limit count for a given IP.
    pub async fn get_mobile_welcome_email_rate_limit(
        &self,
        ip: &str,
    ) -> anyhow::Result<Option<u64>> {
        let key = mobile_welcome_email_rate_limit!(ip);
        macro_redis::get::get_optional::<u64>(&self.inner, &key).await
    }

    /// Increments the mobile welcome email rate limit for a given IP.
    pub async fn increment_mobile_welcome_email_rate_limit(
        &self,
        ip: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        let key = mobile_welcome_email_rate_limit!(ip);
        macro_redis::incr::incr_with_expiry(&self.inner, &key, expiry_seconds).await
    }
}
