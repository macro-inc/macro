//! Domain ports for upstream OAuth providers.

use std::{future::Future, pin::Pin};

use super::models::{RefreshToken, UpstreamTokens};

/// Boxed future returning a token grant from the upstream provider.
pub type UpstreamTokensFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<UpstreamTokens>> + Send + 'a>>;

/// Upstream OAuth provider used by the broker.
pub trait OAuthProvider: Send + Sync {
    /// Builds the upstream authorize URL for a broker session.
    fn construct_authorize_url(&self, state: &str) -> anyhow::Result<String>;

    /// Exchanges an upstream authorization code for tokens.
    fn exchange_authorization_code<'a>(&'a self, code: &'a str) -> UpstreamTokensFuture<'a>;

    /// Refreshes an upstream access token using the refresh token grant.
    fn refresh_access_token<'a>(
        &'a self,
        refresh_token: &'a RefreshToken,
    ) -> UpstreamTokensFuture<'a>;
}
