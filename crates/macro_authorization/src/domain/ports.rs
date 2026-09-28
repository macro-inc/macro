use std::{fmt::Debug, future::Future};

use model_user::UserContext;
use rootcause::Report;

use super::models::{
    BotActingUserClaims, BotAuthentication, BotScope, BotTokenAuthorization, HarnessAuthentication,
    HarnessTokenAuthorization, InternalIdentityClaims, MacroAuthorizationError, ResolvedApiKeyUser,
    ResolvedBotActingUser, ValidatedIdentity,
};
use uuid::Uuid;

/// Persistence facts required to authorize bot credentials.
pub trait BotAuthorizationRepo: Clone + Send + Sync + 'static {
    /// Repository error.
    type Err: Debug + Send;

    /// Find a currently valid token and its bot ownership facts.
    fn find_valid_bot_token(
        &self,
        token: &str,
    ) -> impl Future<Output = Result<Option<BotTokenAuthorization>, Self::Err>> + Send;

    /// Mark a validated token as used.
    fn mark_token_used(&self, token_id: Uuid)
    -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Resolve acting-user claims to user-store facts.
    fn find_acting_user(
        &self,
        claims: &BotActingUserClaims,
    ) -> impl Future<Output = Result<Option<ResolvedBotActingUser>, Self::Err>> + Send;

    /// Check whether a user is a current member of a team.
    fn user_has_team(
        &self,
        fusion_user_id: &str,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Validates bot credentials and resolves verified acting-user identities.
pub trait BotAuthorizer: Clone + Send + Sync + 'static {
    /// Authorize a bot token, verifying and resolving any acting-user claims.
    fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
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
        _bot_scope: BotScope,
        _acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Persistence facts required to authorize a user API key.
pub trait UserApiKeyAuthorizationRepo: Clone + Send + Sync + 'static {
    /// Repository error.
    type Err: Debug + Send;

    /// Resolve the owner identity of a currently valid user API key.
    ///
    /// `api_key` is the raw secret from the request. Implementations persist
    /// and match SHA-256 of its UTF-8 bytes, never the secret itself.
    fn find_key_owner(
        &self,
        api_key: &str,
    ) -> impl Future<Output = Result<Option<ResolvedApiKeyUser>, Self::Err>> + Send;
}

/// Validates user API key credentials and resolves the owner's identity.
pub trait UserApiKeyAuthorizer: Clone + Send + Sync + 'static {
    /// Authorize a user API key and return the owner's user context.
    fn authorize_user_api_key(
        &self,
        api_key: &str,
    ) -> impl Future<Output = Result<UserContext, Report<MacroAuthorizationError>>> + Send;
}

/// User API key authorizer used by services that do not support this credential.
#[derive(Clone)]
pub struct NoUserApiKeyAuthorizer;

impl UserApiKeyAuthorizer for NoUserApiKeyAuthorizer {
    async fn authorize_user_api_key(
        &self,
        _api_key: &str,
    ) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Persistence facts required to authorize harness credentials.
pub trait HarnessAuthorizationRepo: Clone + Send + Sync + 'static {
    /// Repository error.
    type Err: Debug + Send;

    /// Find a currently valid token and its harness ownership facts.
    fn find_valid_harness_token(
        &self,
        token: &str,
    ) -> impl Future<Output = Result<Option<HarnessTokenAuthorization>, Self::Err>> + Send;

    /// Mark a validated token as used.
    fn mark_harness_token_used(
        &self,
        token_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Resolve a Macro user id to user-store facts.
    fn find_user(
        &self,
        macro_user_id: &str,
    ) -> impl Future<Output = Result<Option<ResolvedBotActingUser>, Self::Err>> + Send;

    /// Check whether a user is a current member of a team.
    fn user_has_team(
        &self,
        fusion_user_id: &str,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Validates harness credentials and resolves verified acting-user identities.
pub trait HarnessAuthorizer: Clone + Send + Sync + 'static {
    /// Authorize a harness token, verifying and resolving the acting user.
    ///
    /// `acting_user_claim` is an unverified Macro user id the daemon forwards
    /// (a mention sender); absent, the acting user defaults to the harness
    /// owner or, for team harnesses, its creator.
    fn authorize_harness(
        &self,
        harness_token: &str,
        acting_user_claim: Option<String>,
    ) -> impl Future<Output = Result<HarnessAuthentication, Report<MacroAuthorizationError>>> + Send;
}

/// Harness authorizer used by services that do not support harness authentication.
#[derive(Clone)]
pub struct NoHarnessAuthorizer;

impl HarnessAuthorizer for NoHarnessAuthorizer {
    async fn authorize_harness(
        &self,
        _harness_token: &str,
        _acting_user_claim: Option<String>,
    ) -> Result<HarnessAuthentication, Report<MacroAuthorizationError>> {
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
        _bot_scope: BotScope,
        _acting_user: Option<BotActingUserClaims>,
    ) -> impl Future<Output = Result<BotAuthentication, Report<MacroAuthorizationError>>> + Send
    {
        async { Err(Report::new(MacroAuthorizationError::InvalidCredentials)) }
    }

    /// Authorize a harness token, verifying any acting-user claim.
    ///
    /// Services reject harness credentials unless they explicitly provide a
    /// harness authorizer.
    fn authorize_harness(
        &self,
        _harness_token: &str,
        _acting_user_claim: Option<String>,
    ) -> impl Future<Output = Result<HarnessAuthentication, Report<MacroAuthorizationError>>> + Send
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

    /// Authorize a user API key and return the owner's user context.
    ///
    /// Services reject user API keys unless they explicitly provide a user API
    /// key authorizer.
    fn authorize_user_api_key(
        &self,
        _api_key: &str,
    ) -> impl Future<Output = Result<UserContext, Report<MacroAuthorizationError>>> + Send {
        async { Err(Report::new(MacroAuthorizationError::InvalidCredentials)) }
    }
}
