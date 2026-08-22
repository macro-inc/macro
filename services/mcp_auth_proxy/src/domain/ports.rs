//! Domain ports for upstream OAuth providers.

use std::{future::Future, pin::Pin};

use super::models::{
    AccessToken, AuthorizationSession, CompletePasswordless, IssuedAuthorizationCode,
    PasswordlessStartResult, RefreshToken, SessionId, StartPasswordless, UpstreamAuthorize,
};

/// Boxed future returning an access/refresh token pair.
pub type TokenPairFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<(AccessToken, RefreshToken)>> + Send + 'a>>;

/// Boxed future returned by product passwordless start.
pub type PasswordlessStartFuture<'a> = Pin<
    Box<dyn Future<Output = Result<PasswordlessStartResult, PasswordlessStartError>> + Send + 'a>,
>;

/// Boxed future returned by product passwordless completion.
pub type PasswordlessCompleteFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<(AccessToken, RefreshToken), PasswordlessCompleteError>>
            + Send
            + 'a,
    >,
>;

/// Upstream OAuth provider used by the broker.
pub trait OAuthProvider: Send + Sync {
    /// Builds a FusionAuth authorize URL for the selected identity provider.
    fn construct_authorize_url(&self, destination: &UpstreamAuthorize) -> anyhow::Result<String>;

    /// Exchanges an upstream authorization code for tokens.
    fn exchange_authorization_code<'a>(&'a self, code: &'a str) -> TokenPairFuture<'a>;

    /// Refreshes an upstream access token using the refresh token grant.
    fn refresh_access_token<'a>(&'a self, refresh_token: &'a RefreshToken) -> TokenPairFuture<'a>;
}

/// Product passwordless operations provided by authentication service.
pub trait ProductPasswordless: Send + Sync {
    /// Starts passwordless login or resolves the email domain to SSO.
    fn start<'a>(&'a self, command: StartPasswordless) -> PasswordlessStartFuture<'a>;

    /// Exchanges a passwordless code for the standard FusionAuth token pair.
    fn complete<'a>(&'a self, command: CompletePasswordless) -> PasswordlessCompleteFuture<'a>;
}

/// Error returned when authentication service cannot start passwordless login.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PasswordlessStartError {
    /// Authentication service rejected the email address.
    #[error("invalid email")]
    InvalidEmail,
    /// Authentication service rate-limited the email address.
    #[error("passwordless start rate limited")]
    RateLimited,
    /// Authentication service could not start passwordless login.
    #[error("passwordless start unavailable")]
    Unavailable,
}

/// Error returned when authentication service cannot complete passwordless login.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PasswordlessCompleteError {
    /// Authentication service rejected the passwordless code.
    #[error("invalid passwordless code")]
    InvalidOtp,
    /// Authentication service rate-limited passwordless completion.
    #[error("passwordless completion rate limited")]
    RateLimited,
    /// Authentication service could not complete passwordless login.
    #[error("passwordless completion unavailable")]
    Unavailable,
}

/// Storage for short-lived authorization sessions and issued codes.
pub trait InflightAuthStore: Send + Sync {
    /// Inserts a new authorization session.
    fn insert_session(
        &self,
        session: &AuthorizationSession,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Loads an authorization session without consuming it.
    fn load_session(
        &self,
        session_id: &SessionId,
    ) -> impl Future<Output = anyhow::Result<Option<AuthorizationSession>>> + Send;

    /// Replaces an authorization session and refreshes its expiry.
    fn replace_session(
        &self,
        session: &AuthorizationSession,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Removes and returns an authorization session.
    fn take_session(
        &self,
        session_id: &SessionId,
    ) -> impl Future<Output = anyhow::Result<Option<AuthorizationSession>>> + Send;

    /// Inserts a broker-issued authorization code.
    fn insert_issued(
        &self,
        code: &str,
        issued: IssuedAuthorizationCode,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Removes and returns a broker-issued authorization code.
    fn take_issued(
        &self,
        code: &str,
    ) -> impl Future<Output = anyhow::Result<Option<IssuedAuthorizationCode>>> + Send;

    /// Removes expired entries when required by the backing store.
    fn cleanup_expired(&self) -> impl Future<Output = anyhow::Result<()>> + Send;
}
