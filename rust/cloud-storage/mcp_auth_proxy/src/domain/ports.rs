//! Domain ports for upstream OAuth providers.

use std::{future::Future, pin::Pin};

use super::models::{AccessToken, RefreshToken};

/// Upstream OAuth provider used by the broker.
pub trait OAuthProvider: Send + Sync {
    /// Builds the upstream authorize URL for a broker session.
    fn construct_authorize_url(&self, state: &str) -> anyhow::Result<String>;

    /// Exchanges an upstream authorization code for tokens.
    fn exchange_authorization_code<'a>(
        &'a self,
        code: &'a str,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<(AccessToken, RefreshToken)>> + Send + 'a>>;

    /// Refreshes an upstream access token using the current access token and
    /// refresh token pair.
    fn refresh_access_token<'a>(
        &'a self,
        access_token: &'a AccessToken,
        refresh_token: &'a RefreshToken,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<(AccessToken, RefreshToken)>> + Send + 'a>>;
}
