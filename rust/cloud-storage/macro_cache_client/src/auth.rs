use crate::MacroCache;

pub static MACRO_MOBILE_LOGIN_SESSION_PREFIX: &str = "mbl_login:";
pub static MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS: u64 = 5 * 60;

/// This is the length of time a passwordless login code is valid for within FusionAuth
pub static MACRO_PASSWORDLESS_LOGIN_CODE_EXPIRY_SECONDS: u64 = 600;

/// How long after account creation the first completed login is still
/// attributed as a signup (the create-user webhook and the auth callback run
/// within the same auth flow, so this only needs to cover slow IdP round trips).
pub static MACRO_JUST_SIGNED_UP_EXPIRY_SECONDS: u64 = 30 * 60;

/// Generates the rate limit key for channel invites for a given ip
macro_rules! macro_passwordless_login_code {
    ($email:expr) => {
        format!("pw_login_code:{}", $email)
    };
}

/// Generates the "account was just created" marker key for a given email
fn just_signed_up_key(email: &str) -> String {
    format!("just_signed_up:{}", email.to_lowercase())
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
        let key = just_signed_up_key(email);
        macro_redis::set::set_with_expiry(&self.inner, &key, 1, MACRO_JUST_SIGNED_UP_EXPIRY_SECONDS)
            .await
    }

    /// Consumes the just-signed-up marker for an email. Returns true exactly
    /// once per marker: GETDEL is atomic, so the first caller wins.
    pub async fn take_user_just_signed_up(&self, email: &str) -> anyhow::Result<bool> {
        let key = just_signed_up_key(email);
        let value = macro_redis::get::get_del_optional::<u8>(&self.inner, &key).await?;
        Ok(value.is_some())
    }
}
