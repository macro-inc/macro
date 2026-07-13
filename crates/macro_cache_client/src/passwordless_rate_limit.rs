use anyhow::Context;

use crate::MacroCache;

pub static MACRO_RATE_LIMIT_PASSWORDLESS: &str = "rtl_passwordless:";
pub static MACRO_RATE_LIMIT_PASSWORDLESS_DAILY: &str = "rtl_passwordless_daily:";
pub static MACRO_RATE_LIMIT_IP: &str = "rtl_ip:";

impl MacroCache {
    /// Gets the passwordless rate limit for a given email
    pub async fn get_passwordless_rate_limit(&self, email: &str) -> anyhow::Result<Option<u64>> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;

        let key = format!("{MACRO_RATE_LIMIT_PASSWORDLESS}{normalized_email}");
        macro_redis::get::get_optional::<u64>(&self.inner, &key).await
    }

    /// Increments the passwordless rate limit for a given email
    pub async fn increment_passwordless_rate_limit(
        &self,
        email: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = format!("{MACRO_RATE_LIMIT_PASSWORDLESS}{normalized_email}");
        macro_redis::incr::incr_with_expiry(&self.inner, &key, expiry_seconds).await
    }

    /// Deletes the passwordless rate limit for a given email
    pub async fn delete_passwordless_rate_limit(&self, email: &str) -> anyhow::Result<()> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = format!("{MACRO_RATE_LIMIT_PASSWORDLESS}{normalized_email}");
        macro_redis::delete::delete(&self.inner, &key).await
    }

    /// Gets the daily passwordless rate limit for a given email
    pub async fn get_daily_passwordless_rate_limit(
        &self,
        email: &str,
    ) -> anyhow::Result<Option<u64>> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = format!("{MACRO_RATE_LIMIT_PASSWORDLESS_DAILY}{normalized_email}");
        macro_redis::get::get_optional::<u64>(&self.inner, &key).await
    }

    /// Increments the daily passwordless rate limit for a given email
    pub async fn increment_passwordless_daily_rate_limit(
        &self,
        email: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = format!("{MACRO_RATE_LIMIT_PASSWORDLESS_DAILY}{normalized_email}");
        macro_redis::incr::incr_with_expiry(&self.inner, &key, expiry_seconds).await
    }

    /// Deletes the daily passwordless rate limit for a given email
    pub async fn delete_passwordless_daily_rate_limit(&self, email: &str) -> anyhow::Result<()> {
        let normalized_email =
            email_validator::normalize_email(email).context("unable to normalize email")?;
        let key = format!("{MACRO_RATE_LIMIT_PASSWORDLESS_DAILY}{normalized_email}");
        macro_redis::delete::delete(&self.inner, &key).await
    }
}
