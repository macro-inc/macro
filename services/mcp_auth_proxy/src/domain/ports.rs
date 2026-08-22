//! Domain ports for upstream OAuth providers.

use std::{future::Future, pin::Pin};

use super::models::{
    AccessToken, AuthorizationSession, IssuedAuthorizationCode, RefreshToken, SessionId,
};

/// Boxed future returning an access/refresh token pair.
pub type TokenPairFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<(AccessToken, RefreshToken)>> + Send + 'a>>;

/// Upstream OAuth provider used by the broker for token refresh.
pub trait OAuthProvider: Send + Sync {
    /// Refreshes an upstream access token using the refresh token grant.
    fn refresh_access_token<'a>(&'a self, refresh_token: &'a RefreshToken) -> TokenPairFuture<'a>;
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
