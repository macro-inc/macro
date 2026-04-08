//! Domain ports for upstream OAuth providers.

use std::{future::Future, pin::Pin};

use super::models::{AccessToken, RefreshToken};

/// Boxed future returning an access/refresh token pair.
pub type TokenPairFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<(AccessToken, RefreshToken)>> + Send + 'a>>;

/// Upstream OAuth provider used by the broker.
pub trait OAuthProvider: Send + Sync {
    /// Builds the upstream authorize URL for a broker session.
    fn construct_authorize_url(&self, state: &str) -> anyhow::Result<String>;

    /// Exchanges an upstream authorization code for tokens.
    fn exchange_authorization_code<'a>(&'a self, code: &'a str) -> TokenPairFuture<'a>;

    /// Refreshes an upstream access token using the refresh token grant.
    fn refresh_access_token<'a>(&'a self, refresh_token: &'a RefreshToken) -> TokenPairFuture<'a>;
}
