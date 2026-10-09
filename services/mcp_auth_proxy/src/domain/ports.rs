//! Domain ports for upstream OAuth providers.

use std::{future::Future, pin::Pin};

use super::models::{RefreshToken, RegisteredClient, UpstreamTokens};

/// Boxed future returning a token grant from the upstream provider.
pub type UpstreamTokensFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<UpstreamTokens>> + Send + 'a>>;

/// Boxed future returning nothing on success.
pub type StoreWriteFuture<'a> = Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + 'a>>;

/// Boxed future returning a registered client, if one exists.
pub type RegisteredClientFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<Option<RegisteredClient>>> + Send + 'a>>;

/// Boxed future returning a client id, if one is bound.
pub type BoundClientIdFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<Option<String>>> + Send + 'a>>;

/// Store of clients created through dynamic client registration.
///
/// Registrations outlive a single handshake: a client registers once and then
/// authorizes repeatedly, so this is separate from the in-flight handshake
/// state and each entry must survive well beyond an authorization code.
pub trait ClientRegistrationStore: Send + Sync {
    /// Persists a newly registered client.
    fn insert_client<'a>(&'a self, client: &'a RegisteredClient) -> StoreWriteFuture<'a>;

    /// Loads a registered client by id, returning `None` when the id is
    /// unknown or its registration has lapsed.
    ///
    /// Implementations may treat a successful lookup as use of the
    /// registration and extend its lifetime accordingly.
    fn find_client<'a>(&'a self, client_id: &'a str) -> RegisteredClientFuture<'a>;
}

/// Store recording which client each outstanding refresh token was issued to.
///
/// Refresh tokens are keyed by digest rather than by their own value so the
/// store never holds a usable credential.
pub trait RefreshTokenBindingStore: Send + Sync {
    /// Binds a refresh token digest to the client that obtained it, replacing
    /// any existing binding for that digest.
    fn bind<'a>(
        &'a self,
        refresh_token_digest: &'a str,
        client_id: &'a str,
    ) -> StoreWriteFuture<'a>;

    /// Returns the client a refresh token digest is bound to, if any.
    fn bound_client<'a>(&'a self, refresh_token_digest: &'a str) -> BoundClientIdFuture<'a>;

    /// Drops the binding for a refresh token digest.
    fn unbind<'a>(&'a self, refresh_token_digest: &'a str) -> StoreWriteFuture<'a>;
}

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
