use std::collections::HashMap;

use anyhow::Context;

use crate::MacroCache;

/// Generates the rate limit key for channel creation for a given user by their email
macro_rules! macro_rate_limit_channel_invite {
    ($email:expr) => {
        format!("rtl_channel_invite:{}", $email)
    };
}

/// Generates the rate limit key for channel invites for a given user by their email and the email
/// for the user that invited them
macro_rules! macro_rate_limit_channel_invited {
    ($email:expr, $invited_by_email:expr) => {
        format!("rtl_channel_invited:{}_{}", $email, $invited_by_email)
    };
}

/// Generates the rate limit key for channel invites for a given ip
macro_rules! macro_rate_limit_channel_invite_ip {
    ($ip:expr) => {
        format!("rtl_channel_invite_ip:{}", $ip)
    };
}

/// Generates the rate limit key for invite to team for a given email
macro_rules! macro_rate_limit_invite_to_team {
    ($email:expr) => {
        format!("rtl_invite_to_team:{}", $email)
    };
}

impl MacroCache {
    /// Get the channel invite rate limit for a given email.
    /// This is the number of times a given email has made a channel invite event during the keys
    /// lifetime.
    pub async fn get_channel_invite_rate_limit(&self, email: &str) -> anyhow::Result<Option<u64>> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;

        macro_redis::get::get_optional::<u64>(
            &self.inner,
            &macro_rate_limit_channel_invite!(normalized_email),
        )
        .await
    }

    /// Increments the channel invite rate limit for a given email.
    /// This is the number of times a given email has made a channel invite event during the keys
    /// lifetime.
    pub async fn increment_channel_invite_rate_limit(
        &self,
        email: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;
        macro_redis::incr::incr_with_expiry(
            &self.inner,
            &macro_rate_limit_channel_invite!(normalized_email),
            expiry_seconds,
        )
        .await
    }

    /// Get the invite to team rate limit for a given email.
    /// This is the number of times a given email has been invited to a team during the keys
    /// lifetime.
    pub async fn get_invite_to_team_rate_limit(&self, email: &str) -> anyhow::Result<Option<u64>> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;
        macro_redis::get::get_optional::<u64>(
            &self.inner,
            &macro_rate_limit_invite_to_team!(normalized_email),
        )
        .await
    }

    /// Increments the invite to team rate limit for a given email.
    /// This is the number of times a given email has been invited to a team during the keys
    /// lifetime.
    pub async fn increment_invite_to_team_rate_limit(
        &self,
        email: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;
        macro_redis::incr::incr_with_expiry(
            &self.inner,
            &macro_rate_limit_invite_to_team!(normalized_email),
            expiry_seconds,
        )
        .await
    }

    /// Get the channel invite rate limit for a given ip.
    /// This is the number of times a given ip has made a channel invite event during the keys
    /// lifetime.
    pub async fn get_channel_invite_ip_rate_limit(&self, ip: &str) -> anyhow::Result<Option<u64>> {
        macro_redis::get::get_optional::<u64>(&self.inner, &macro_rate_limit_channel_invite_ip!(ip))
            .await
    }

    /// Increments the channel invite rate limit for a given ip.
    /// This is the number of times a given ip has made a channel invite event during the keys
    /// lifetime.
    pub async fn increment_channel_invite_ip_rate_limit(
        &self,
        ip: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        macro_redis::incr::incr_with_expiry(
            &self.inner,
            &macro_rate_limit_channel_invite_ip!(ip),
            expiry_seconds,
        )
        .await
    }

    /// Get the channel invited rate limit for a given email.
    /// This is the number of times a given email has been invited to a channel during the keys
    /// lifetime.
    pub async fn get_channel_invited_rate_limit(
        &self,
        email: &str,
        invited_by_email: &str,
    ) -> anyhow::Result<Option<u64>> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;

        let normalized_invited_by_email = email_validator::normalize_email(invited_by_email)
            .with_context(|| format!("unable to normalize email {}", invited_by_email))?;

        macro_redis::get::get_optional::<u64>(
            &self.inner,
            &macro_rate_limit_channel_invited!(normalized_email, normalized_invited_by_email),
        )
        .await
    }

    /// Given a list of emails and the user generating the invite, this will return each emails
    /// rate limit if they've been invited by that user recently.
    /// Returns a list of tuples of (email, rate_limit)
    pub async fn get_channel_invited_rate_limit_bulk(
        &self,
        emails: &[String],
        invited_by_email: &str,
    ) -> anyhow::Result<HashMap<String, Option<u64>>> {
        // Get all normalized emails
        let normalized_emails = emails
            .iter()
            .filter_map(|email| {
                email_validator::normalize_email(email)
                    .map(|normalized_email| normalized_email.to_string())
            })
            .collect::<Vec<String>>();

        let normalized_invited_by_email = email_validator::normalize_email(invited_by_email)
            .with_context(|| format!("unable to normalize email {}", invited_by_email))?;

        let keys = normalized_emails
            .iter()
            .map(|email| macro_rate_limit_channel_invited!(email, normalized_invited_by_email))
            .collect::<Vec<String>>();

        let limits = macro_redis::get::get_multiple::<u64>(&self.inner, &keys).await?;

        let result = emails.iter().map(|e| e.to_string()).zip(limits).collect();
        Ok(result)
    }

    /// Increments the channel invited rate limit for a given email.
    /// This is the number of times a given email has been invited to a channel during the keys
    /// lifetime.
    pub async fn increment_channel_invited_rate_limit(
        &self,
        email: &str,
        invited_by_email: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        let normalized_email = email_validator::normalize_email(email)
            .with_context(|| format!("unable to normalize email {}", email))?;

        let normalized_invited_by_email = email_validator::normalize_email(invited_by_email)
            .with_context(|| format!("unable to normalize email {}", invited_by_email))?;

        macro_redis::incr::incr_with_expiry(
            &self.inner,
            &macro_rate_limit_channel_invited!(normalized_email, normalized_invited_by_email),
            expiry_seconds,
        )
        .await
    }

    /// Increments the channel invited rate limit for given emails.
    /// This is the number of times a given email has been invited to a channel during the keys
    /// lifetime.
    pub async fn increment_channel_invited_rate_limit_bulk(
        &self,
        emails: &[String],
        invited_by_email: &str,
        expiry_seconds: i64,
    ) -> anyhow::Result<()> {
        // Get all normalized emails
        let normalized_emails = emails
            .iter()
            .filter_map(|email| {
                email_validator::normalize_email(email)
                    .map(|normalized_email| normalized_email.to_string())
            })
            .collect::<Vec<String>>();

        let normalized_invited_by_email = email_validator::normalize_email(invited_by_email)
            .with_context(|| format!("unable to normalize email {}", invited_by_email))?;

        let keys = normalized_emails
            .iter()
            .map(|email| macro_rate_limit_channel_invited!(email, normalized_invited_by_email))
            .collect::<Vec<String>>();

        macro_redis::incr::incr_with_expiry_bulk(&self.inner, &keys, expiry_seconds).await
    }
}
