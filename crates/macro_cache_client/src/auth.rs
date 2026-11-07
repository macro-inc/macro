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

    /// Sets the mobile login session
    pub async fn set_mobile_login_session(
        &self,
        session_code: &str,
        refresh_token: &str,
    ) -> anyhow::Result<()> {
        let key = format!("{}{}", MACRO_MOBILE_LOGIN_SESSION_PREFIX, session_code);
        macro_redis::set::set_with_expiry(
            &self.inner,
            &key,
            refresh_token,
            MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS,
        )
        .await
    }

    /// Given a session code, gets the mobile login session
    pub async fn get_mobile_login_session(
        &self,
        session_code: &str,
    ) -> anyhow::Result<Option<String>> {
        let key = format!("{}{}", MACRO_MOBILE_LOGIN_SESSION_PREFIX, session_code);
        macro_redis::get::get_optional::<String>(&self.inner, &key).await
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
