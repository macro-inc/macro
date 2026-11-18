use std::time::{Duration, Instant};

use anyhow::Context;
use redis::AsyncCommands;

use crate::MacroCache;

#[cfg(test)]
mod test;

pub static MACRO_MOBILE_LOGIN_SESSION_PREFIX: &str = "mbl_login:";
pub static MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS: u64 = 5 * 60;

/// This is the length of time a passwordless login code is valid for within FusionAuth
/// This matches the time configured in the fusionauth tenant with some buffer time (30s)
pub static MACRO_PASSWORDLESS_LOGIN_CODE_EXPIRY_SECONDS: u64 = 630;

/// How long after account creation the first completed login is still
/// attributed as a signup (the create-user webhook and the auth callback run
/// within the same auth flow, so this only needs to cover slow IdP round trips).
pub static MACRO_JUST_SIGNED_UP_EXPIRY_SECONDS: u64 = 30 * 60;

/// How long a passwordless signup waits for its first completed sign-in
/// before its deferred onboarding (domain team auto-join, referral credit) is
/// dropped. Longer than one code's lifetime so a user can request new codes.
pub static MACRO_PASSWORDLESS_PENDING_SIGNUP_EXPIRY_SECONDS: u64 = 7 * 24 * 60 * 60;

/// Reads a mobile login session and deletes it in one step, returning the
/// stored refresh token and its remaining lifetime in milliseconds.
const TAKE_MOBILE_LOGIN_SESSION: &str = r"
local refresh_token = redis.call('GET', KEYS[1])
if not refresh_token then
  return false
end
local remaining_ms = redis.call('PTTL', KEYS[1])
redis.call('DEL', KEYS[1])
return {refresh_token, remaining_ms}
";

fn mobile_login_session_key(session_code: &str) -> String {
    format!("{MACRO_MOBILE_LOGIN_SESSION_PREFIX}{session_code}")
}

/// A redeemed session code's session: the refresh token it was minted for and
/// the moment the code expires. `Debug` leaves the token out.
pub struct MobileLoginSession {
    refresh_token: String,
    expires_at: Instant,
}

impl MobileLoginSession {
    /// The refresh token the session code was minted for.
    pub fn refresh_token(&self) -> &str {
        &self.refresh_token
    }

    /// How long the code has left, counted from its original deadline.
    fn remaining(&self) -> Duration {
        self.expires_at.saturating_duration_since(Instant::now())
    }
}

impl std::fmt::Debug for MobileLoginSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MobileLoginSession")
            .field("remaining", &self.remaining())
            .finish_non_exhaustive()
    }
}

/// Generates the rate limit key for channel invites for a given ip
macro_rules! macro_passwordless_login_code {
    ($email:expr) => {
        format!("pw_login_code:{}", $email)
    };
}

/// Generates the "account was just created" marker key for a given email
macro_rules! macro_just_signed_up {
    ($email:expr) => {
        format!("just_signed_up:{}", $email)
    };
}

/// Generates the pending passwordless signup marker key for a given email
macro_rules! macro_passwordless_pending_signup {
    ($email:expr) => {
        format!("pw_pending_signup:{}", $email)
    };
}

/// Onboarding deferred from a passwordless signup until its address is proven
/// by a completed sign-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingPasswordlessSignup {
    /// The referral code the signup was started with, if any.
    pub referral_code: Option<String>,
}

impl MacroCache {
    /// **LEGACY** removes a user's session from redis
    /// This is used for legacy auth only
    pub async fn delete_user(&self, user_id: &str) -> anyhow::Result<()> {
        let mut keys: Vec<String> = vec![user_id.to_string()];

        let session_id = macro_redis::get::get_optional::<String>(&self.inner, user_id).await?;

        if let Some(session_id) = session_id {
            keys.push(session_id.clone());
            keys.push(format!("{session_id}-id"));
        }

        let keys = keys.iter().map(|k| k.as_str()).collect::<Vec<&str>>();
        macro_redis::delete::delete_multiple(&self.inner, &keys).await
    }

    /// Stores a mobile login session under a freshly minted session code.
    ///
    /// Errors never name the key: it embeds the code, and callers log them.
    pub async fn set_mobile_login_session(
        &self,
        session_code: &str,
        refresh_token: &str,
    ) -> anyhow::Result<()> {
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        connection
            .set_ex::<_, _, ()>(
                mobile_login_session_key(session_code),
                refresh_token,
                MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS,
            )
            .await
            .context("unable to store mobile login session")
    }

    /// Redeems a session code: returns its session and deletes it in one
    /// atomic step, so a code succeeds at most once however many callers race
    /// for it. `None` means the code is unknown, expired or already redeemed.
    pub async fn take_mobile_login_session(
        &self,
        session_code: &str,
    ) -> anyhow::Result<Option<MobileLoginSession>> {
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        let taken: Option<(String, i64)> = redis::Script::new(TAKE_MOBILE_LOGIN_SESSION)
            .key(mobile_login_session_key(session_code))
            .invoke_async(&mut connection)
            .await
            .context("unable to redeem mobile login session")?;
        // Fix the deadline now: a restore after a slow refresh must not get
        // back the time the refresh took.
        Ok(
            taken.map(|(refresh_token, remaining_ms)| MobileLoginSession {
                refresh_token,
                expires_at: Instant::now()
                    + Duration::from_millis(u64::try_from(remaining_ms).unwrap_or(0)),
            }),
        )
    }

    /// Puts back a session whose redemption failed after it was taken, until
    /// its original deadline, so the client can retry. Never restores an
    /// expired code or overwrites one that exists again. Returns whether it
    /// was restored.
    pub async fn restore_mobile_login_session(
        &self,
        session_code: &str,
        session: &MobileLoginSession,
    ) -> anyhow::Result<bool> {
        let remaining_ms = u64::try_from(session.remaining().as_millis()).unwrap_or(u64::MAX);
        if remaining_ms == 0 {
            return Ok(false);
        }
        let mut connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;
        let options = redis::SetOptions::default()
            .conditional_set(redis::ExistenceCheck::NX)
            .with_expiration(redis::SetExpiry::PX(remaining_ms));
        let restored: Option<String> = connection
            .set_options(
                mobile_login_session_key(session_code),
                &session.refresh_token,
                options,
            )
            .await
            .context("unable to restore mobile login session")?;
        Ok(restored.is_some())
    }

    /// Sets the passwordless login code for a given email
    pub async fn set_passwordless_login_code(&self, email: &str, code: &str) -> anyhow::Result<()> {
        let key = macro_passwordless_login_code!(email.to_lowercase());

        macro_redis::set::set_with_expiry(
            &self.inner,
            &key,
            code,
            MACRO_PASSWORDLESS_LOGIN_CODE_EXPIRY_SECONDS,
        )
        .await
    }

    /// Gets the passwordless login code for a given email
    pub async fn get_passwordless_login_code(&self, email: &str) -> anyhow::Result<String> {
        let key = macro_passwordless_login_code!(email.to_lowercase());
        macro_redis::get::get::<String>(&self.inner, &key).await
    }

    /// Marks an account as just created so the auth callback that completes the
    /// same flow can attribute the login as a signup.
    pub async fn mark_user_just_signed_up(&self, email: &str) -> anyhow::Result<()> {
        let key = macro_just_signed_up!(email.to_lowercase());
        macro_redis::set::set_with_expiry(&self.inner, &key, 1, MACRO_JUST_SIGNED_UP_EXPIRY_SECONDS)
            .await
    }

    /// Consumes the just-signed-up marker for an email. Returns true exactly
    /// once per marker: GETDEL is atomic, so the first caller wins.
    pub async fn take_user_just_signed_up(&self, email: &str) -> anyhow::Result<bool> {
        let key = macro_just_signed_up!(email.to_lowercase());
        let value = macro_redis::get::get_del_optional::<u8>(&self.inner, &key).await?;
        Ok(value.is_some())
    }

    /// Marks a passwordless signup as unproven: the account is created before
    /// any code is verified, so onboarding that trusts the address waits for
    /// [`Self::take_passwordless_signup_pending`].
    pub async fn mark_passwordless_signup_pending(
        &self,
        email: &str,
        pending: &PendingPasswordlessSignup,
    ) -> anyhow::Result<()> {
        let key = macro_passwordless_pending_signup!(email.to_lowercase());
        // An empty value means no referral code; codes are never empty.
        let value = pending.referral_code.as_deref().unwrap_or_default();
        macro_redis::set::set_with_expiry(
            &self.inner,
            &key,
            value,
            MACRO_PASSWORDLESS_PENDING_SIGNUP_EXPIRY_SECONDS,
        )
        .await
    }

    /// Whether the account for an email is a passwordless signup that has not
    /// completed a sign-in yet.
    pub async fn is_passwordless_signup_pending(&self, email: &str) -> anyhow::Result<bool> {
        let key = macro_passwordless_pending_signup!(email.to_lowercase());
        let value = macro_redis::get::get_optional::<String>(&self.inner, &key).await?;
        Ok(value.is_some())
    }

    /// Consumes the pending passwordless signup for an email once a sign-in has
    /// proven the address. Returns it exactly once: GETDEL is atomic.
    pub async fn take_passwordless_signup_pending(
        &self,
        email: &str,
    ) -> anyhow::Result<Option<PendingPasswordlessSignup>> {
        let key = macro_passwordless_pending_signup!(email.to_lowercase());
        let value = macro_redis::get::get_del_optional::<String>(&self.inner, &key).await?;
        Ok(value.map(|referral_code| PendingPasswordlessSignup {
            referral_code: Some(referral_code).filter(|code| !code.is_empty()),
        }))
    }
}

#[cfg(test)]
mod test;
