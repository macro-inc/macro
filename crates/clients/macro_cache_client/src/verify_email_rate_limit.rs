use anyhow::Context;

use crate::MacroCache;

/// Generates the rate limit key for verify email for a given email by minute
macro_rules! macro_rate_limit_resend_verify_email_minute {
    ($email:expr) => {
        format!("rtl_verify_email_minute:{}", $email)
    };
}

/// Generates the rate limit key for verify email for a given email by day
macro_rules! macro_rate_limit_resend_verify_email_day {
    ($email:expr) => {
        format!("rtl_verify_email_day:{}", $email)
    };
}

/// Generates the rate limit key for generating merge account requests for a given email by minute
macro_rules! macro_rate_limit_merge_email_minute {
    ($email:expr) => {
        format!("rtl_merge_email_minute:{}", $email)
    };
}

/// Generates the rate limit key for generating merge account requests for a given email by day
macro_rules! macro_rate_limit_merge_email_day {
    ($email:expr) => {
        format!("rtl_merge_email_day:{}", $email)
    };
}

pub static MINUTE_EXPIRY_SECONDS: i64 = 60;
pub static DAY_EXPIRY_SECONDS: i64 = 86400; // 60 * 60 * 24

impl MacroCache {
    /// Gets the minute and day rate limit for a given email
    pub async fn get_resend_verify_email_rate_limits(
        &self,
        email: &str,
    ) -> anyhow::Result<(Option<u64>, Option<u64>)> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;

        let key_minute = macro_rate_limit_resend_verify_email_minute!(normalized_email);
        let key_day = macro_rate_limit_resend_verify_email_day!(normalized_email);

        let minute_limit = macro_redis::get::get_optional::<u64>(&self.inner, &key_minute).await?;
        let day_limit = macro_redis::get::get_optional::<u64>(&self.inner, &key_day).await?;

        Ok((minute_limit, day_limit))
    }

    /// Increments the minute and day rate limit for a given email
    pub async fn increment_resend_verify_email_rate_limits(
        &self,
        email: &str,
    ) -> anyhow::Result<()> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;

        let key_minute = macro_rate_limit_resend_verify_email_minute!(normalized_email);
        let key_day = macro_rate_limit_resend_verify_email_day!(normalized_email);

        macro_redis::incr::incr_with_expiry(&self.inner, &key_minute, MINUTE_EXPIRY_SECONDS)
            .await?;

        macro_redis::incr::incr_with_expiry(&self.inner, &key_day, DAY_EXPIRY_SECONDS).await?;

        Ok(())
    }

    /// Gets the minute and day rate limit for a given email
    pub async fn get_merge_email_rate_limits(
        &self,
        email: &str,
    ) -> anyhow::Result<(Option<u64>, Option<u64>)> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;

        let key_minute = macro_rate_limit_merge_email_minute!(normalized_email);
        let key_day = macro_rate_limit_merge_email_day!(normalized_email);

        let minute_limit = macro_redis::get::get_optional::<u64>(&self.inner, &key_minute).await?;
        let day_limit = macro_redis::get::get_optional::<u64>(&self.inner, &key_day).await?;

        Ok((minute_limit, day_limit))
    }

    /// Increments the minute and day rate limit for a given email
    pub async fn increment_merge_email_rate_limits(&self, email: &str) -> anyhow::Result<()> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;

        let key_minute = macro_rate_limit_merge_email_minute!(normalized_email);
        let key_day = macro_rate_limit_merge_email_day!(normalized_email);

        macro_redis::incr::incr_with_expiry(&self.inner, &key_minute, MINUTE_EXPIRY_SECONDS)
            .await?;

        macro_redis::incr::incr_with_expiry(&self.inner, &key_day, DAY_EXPIRY_SECONDS).await?;

        Ok(())
    }
}
