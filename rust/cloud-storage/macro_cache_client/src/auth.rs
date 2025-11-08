use crate::MacroCache;

pub static MACRO_MOBILE_LOGIN_SESSION_PREFIX: &str = "mbl_login:";
pub static MACRO_MOBILE_LOGIN_SESSION_EXPIRY_SECONDS: u64 = 5 * 60;

/// This is the length of time a passwordless login code is valid for within FusionAuth
pub static MACRO_PASSWORDLESS_LOGIN_CODE_EXPIRY_SECONDS: u64 = 600;

/// Generates the rate limit key for channel invites for a given ip
macro_rules! macro_passwordless_login_code {
    ($email:expr) => {
        format!("pw_login_code:{}", $email)
    };
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
}
