//! Recent sign-in checks use the signed FusionAuth auth_time, never token issuance time.
use crate::domain::{models::*, ports::Reauthentication};
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use macro_auth::middleware::decode_jwt::{JwtToken, JwtValidationArgs};

/// Checks signed auth_time without extending it on token refresh.
pub struct SessionReauthentication {
    /// The same trusted signing-key validation used for Macro session authentication.
    pub validation: JwtValidationArgs,
}

#[async_trait]
impl Reauthentication for SessionReauthentication {
    async fn verify(&self, actor: &Actor) -> Result<(), Error> {
        let token = actor
            .session_token
            .as_ref()
            .ok_or(Error::ReauthenticationRequired)?;
        if token.0.len() > 16384 {
            return Err(Error::ReauthenticationRequired);
        }
        let verified = macro_auth::middleware::decode_jwt::handler(&self.validation, &token.0)
            .map_err(|_| Error::ReauthenticationRequired)?;
        let JwtToken::MacroAccessToken(verified) = verified else {
            return Err(Error::ReauthenticationRequired);
        };
        if verified.macro_user_id != actor.user_id.as_ref() {
            return Err(Error::ReauthenticationRequired);
        }
        let payload = token
            .0
            .split('.')
            .nth(1)
            .ok_or(Error::ReauthenticationRequired)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| Error::ReauthenticationRequired)?;
        #[derive(serde::Deserialize)]
        struct Claims {
            auth_time: i64,
        }
        let claims: Claims =
            serde_json::from_slice(&bytes).map_err(|_| Error::ReauthenticationRequired)?;
        validate_auth_time(claims.auth_time, chrono::Utc::now().timestamp())
    }
}
fn validate_auth_time(auth_time: i64, now: i64) -> Result<(), Error> {
    let age = now
        .checked_sub(auth_time)
        .ok_or(Error::ReauthenticationRequired)?;
    if !(0..=300).contains(&age) {
        return Err(Error::ReauthenticationRequired);
    }
    Ok(())
}
#[cfg(test)]
mod test;
