#[cfg(test)]
mod test;

use ::macro_auth::{
    error::MacroAuthError,
    middleware::decode_jwt::{self, JwtToken, JwtValidationArgs},
};
use rootcause::Report;
use tracing::Level;

use crate::domain::{
    models::{MacroAuthorizationError, ValidatedCredential, ValidatedIdentity},
    ports::JwtValidator,
};

/// JWT validator backed by the shared `macro_auth` validation implementation.
///
/// The adapter delegates all cryptographic and claims validation to
/// [`decode_jwt::handler`] and converts validated token claims into the
/// authorization domain model.
#[derive(Clone)]
pub struct MacroAuthJwtValidator {
    jwt_validation_args: JwtValidationArgs,
}

impl MacroAuthJwtValidator {
    /// Create a validator with resolved Macro authentication configuration.
    pub fn new(jwt_validation_args: JwtValidationArgs) -> Self {
        Self {
            jwt_validation_args,
        }
    }
}

impl JwtValidator for MacroAuthJwtValidator {
    #[tracing::instrument(err(level = Level::DEBUG), skip(self, jwt))]
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        self.validate_credential(jwt)
            .map(|credential| credential.identity)
    }

    #[tracing::instrument(err(level = Level::DEBUG), skip(self, jwt))]
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        decode_jwt::handler(&self.jwt_validation_args, jwt)
            .map(identity_from_token)
            .map_err(validation_error)
    }
}

fn identity_from_token(token: JwtToken) -> ValidatedCredential {
    let is_macro_api_token = matches!(&token, JwtToken::MacroApiToken(_));
    let (user_id, fusion_user_id, organization_id, agent_id) = match token {
        JwtToken::MacroAccessToken(token) => (
            token.macro_user_id,
            token.root_macro_id.unwrap_or(token.fusion_user_id),
            token.macro_organization_id,
            None,
        ),
        JwtToken::MacroApiToken(token) => (
            token.macro_user_id,
            token.fusion_user_id,
            token.macro_organization_id,
            token.agent_id.map(bot_id::BotId::new_from_uuid),
        ),
    };

    ValidatedCredential {
        is_macro_api_token,
        identity: ValidatedIdentity {
            agent_id,
            user_id,
            fusion_user_id,
            organization_id,
            permissions: None,
        },
    }
}

fn validation_error(error: MacroAuthError) -> Report<MacroAuthorizationError> {
    let authorization_error = match &error {
        MacroAuthError::JwtExpired => MacroAuthorizationError::CredentialsExpired,
        _ => MacroAuthorizationError::InvalidCredentials,
    };

    Report::new(error).context(authorization_error)
}
