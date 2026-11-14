#[cfg(test)]
mod test;

use ::macro_auth::{
    error::MacroAuthError,
    middleware::decode_jwt::{self, JwtToken, JwtValidationArgs},
};
use rootcause::Report;
use tracing::Level;

use crate::domain::{
    models::{CredentialOrigin, MacroAuthorizationError, ValidatedCredential, ValidatedIdentity},
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
    let origin = match &token {
        JwtToken::MacroAccessToken(_) => CredentialOrigin::Session,
        JwtToken::MacroApiToken(token) if token.agent_scope.is_some() => {
            CredentialOrigin::ScopedMacroApiJwt
        }
        JwtToken::MacroApiToken(_) => CredentialOrigin::MacroApiJwt,
    };
    let (user_id, fusion_user_id, organization_id, agent_id, agent_via) = match token {
        JwtToken::MacroAccessToken(token) => (
            token.macro_user_id,
            token.root_macro_id.unwrap_or(token.fusion_user_id),
            token.macro_organization_id,
            None,
            None,
        ),
        JwtToken::MacroApiToken(token) => (
            token.macro_user_id,
            token.fusion_user_id,
            token.macro_organization_id,
            token.agent_id.map(bot_id::BotId::new_from_uuid),
            token.agent_id.and(token.agent_via),
        ),
    };

    ValidatedCredential {
        origin,
        identity: ValidatedIdentity {
            agent_id,
            agent_via,
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
