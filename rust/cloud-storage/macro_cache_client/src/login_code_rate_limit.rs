use anyhow::Context;

use crate::MacroCache;

/// Generates the rate limit key for channel invites for a given ip
macro_rules! macro_passwordless_login_code {
    ($email:expr) => {
        format!("rtl_code:{}", $email)
    };
}

/// Generates the rate limit key for channel invites for a given ip
macro_rules! macro_passwordless_daily_login_code {
    ($email:expr) => {
        format!("rtl_code_daily:{}", $email)
    };
}

impl MacroCache {
    /// Gets the code rate limit for a given email
    pub async fn get_code_rate_limit(&self, email: &str) -> anyhow::Result<Option<u64>> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;

        let key = macro_passwordless_login_code!(normalized_email);
        macro_redis::get::get_optional::<u64>(&self.inner, &key).await
    }

    /// Increments the code rate limit for a given email
    pub async fn increment_code_rate_limit(
        &self,
        email: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = macro_passwordless_login_code!(normalized_email);
        macro_redis::incr::incr_with_expiry(&self.inner, &key, expiry_seconds).await
    }

    /// Deletes the code rate limit for a given email
    pub async fn delete_code_rate_limit(&self, email: &str) -> anyhow::Result<()> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = macro_passwordless_login_code!(normalized_email);
        macro_redis::delete::delete(&self.inner, &key).await
    }

    /// Gets the daily code rate limit for a given email
    pub async fn get_daily_code_rate_limit(&self, email: &str) -> anyhow::Result<Option<u64>> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = macro_passwordless_daily_login_code!(normalized_email);
        macro_redis::get::get_optional::<u64>(&self.inner, &key).await
    }

    /// Increments the daily code rate limit for a given email
    pub async fn increment_daily_code_rate_limit(
        &self,
        email: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = macro_passwordless_daily_login_code!(normalized_email);
        macro_redis::incr::incr_with_expiry(&self.inner, &key, expiry_seconds).await
    }

    /// Deletes the daily code rate limit for a given email
    pub async fn delete_daily_code_rate_limit(&self, email: &str) -> anyhow::Result<()> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = macro_passwordless_daily_login_code!(normalized_email);
        macro_redis::delete::delete(&self.inner, &key).await
    }
}
