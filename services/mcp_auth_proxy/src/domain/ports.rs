//! Domain ports for upstream OAuth providers.

use std::{future::Future, pin::Pin};

use super::models::{RefreshToken, RefreshTokenBinding, RegisteredClient, UpstreamTokens};

/// Boxed future returning a token grant from the upstream provider.
pub type UpstreamTokensFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<UpstreamTokens>> + Send + 'a>>;

/// Boxed future returning nothing on success.
pub type StoreWriteFuture<'a> = Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + 'a>>;

/// Boxed future returning a registered client, if one exists.
pub type RegisteredClientFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<Option<RegisteredClient>>> + Send + 'a>>;

/// Boxed future returning a refresh token binding, if one exists.
pub type RefreshTokenBindingFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<Option<RefreshTokenBinding>>> + Send + 'a>>;

/// Boxed future returning whether a grant has been revoked.
pub type GrantRevokedFuture<'a> = Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send + 'a>>;

/// Boxed future returning nothing once the upstream provider has acted.
pub type UpstreamRevocationFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + 'a>>;

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

/// Store recording which client and grant each outstanding refresh token was
/// issued to, and which grants have been revoked.
///
/// Refresh tokens are keyed by digest rather than by their own value so the
/// store never holds a usable credential.
pub trait RefreshTokenBindingStore: Send + Sync {
    /// Binds a refresh token digest to the client and grant it belongs to,
    /// replacing any existing binding for that digest.
    fn bind<'a>(
        &'a self,
        refresh_token_digest: &'a str,
        binding: &'a RefreshTokenBinding,
    ) -> StoreWriteFuture<'a>;

    /// Returns the binding for a refresh token digest, if any.
    fn binding<'a>(&'a self, refresh_token_digest: &'a str) -> RefreshTokenBindingFuture<'a>;

    /// Drops the binding for a refresh token digest.
    fn unbind<'a>(&'a self, refresh_token_digest: &'a str) -> StoreWriteFuture<'a>;

    /// Records that a grant is revoked, so no refresh token in its family is
    /// honored again. Must outlive every binding that names the grant.
    fn revoke_grant<'a>(&'a self, grant_id: &'a str) -> StoreWriteFuture<'a>;

    /// Returns whether a grant has been revoked.
    fn is_grant_revoked<'a>(&'a self, grant_id: &'a str) -> GrantRevokedFuture<'a>;
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

    /// Revokes an upstream refresh token. Succeeds when the provider no longer
    /// knows the token, so a revocation can be retried.
    fn revoke_refresh_token<'a>(
        &'a self,
        refresh_token: &'a RefreshToken,
    ) -> UpstreamRevocationFuture<'a>;
}
