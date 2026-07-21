use std::future::Future;

use model_user::UserContext;
use rootcause::Report;

use super::models::{
    BotActingUserClaims, BotAuthentication, InternalIdentityClaims, MacroAuthorizationError,
    ValidatedIdentity,
};

/// Validates bot credentials and resolves verified acting-user identities.
pub trait BotAuthorizer: Clone + Send + Sync + 'static {
    /// Authorize a bot token, verifying and resolving any acting-user claims.
    fn authorize_bot(
        &self,
        bot_token: &str,
        acting_user: Option<BotActingUserClaims>,
    ) -> impl Future<Output = Result<BotAuthentication, Report<MacroAuthorizationError>>> + Send;
}

/// Bot authorizer used by services that do not support bot authentication.
#[derive(Clone)]
pub struct NoBotAuthorizer;

impl BotAuthorizer for NoBotAuthorizer {
    async fn authorize_bot(
        &self,
        _bot_token: &str,
        _acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Cryptographic credential validation used by the authorization domain.
///
/// Implementations resolve any required secrets during startup, allowing this
/// operation to remain synchronous.
pub trait JwtValidator: Clone + Send + Sync + 'static {
    /// Validate a credential and return its transport-independent identity.
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>>;
}

/// Authorizes credentials and constructs application user contexts.
///
/// The operation is asynchronous so implementations can later enrich an
/// identity from persistent storage without changing this interface.
pub trait MacroAuthorizationService: Clone + Send + Sync + 'static {
    /// Authorize a credential and return its authenticated user context.
    fn authorize(
        &self,
        jwt: &str,
    ) -> impl Future<Output = Result<UserContext, Report<MacroAuthorizationError>>> + Send;

    /// Authorize a bot token, verifying any acting-user claims.
    ///
    /// Services reject bot credentials unless they explicitly provide a bot
    /// authorizer.
    fn authorize_bot(
        &self,
        _bot_token: &str,
        _acting_user: Option<BotActingUserClaims>,
    ) -> impl Future<Output = Result<BotAuthentication, Report<MacroAuthorizationError>>> + Send
    {
        async { Err(Report::new(MacroAuthorizationError::InvalidCredentials)) }
    }

    /// Authorize an internal service-to-service caller.
    ///
    /// Returns `Ok(None)` when the key is valid but no identity is established
    /// by either the acting-user claim or the configured default.
    fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> impl Future<Output = Result<Option<UserContext>, Report<MacroAuthorizationError>>> + Send;
}
