//! Domain ports for upstream OAuth providers.

use std::{future::Future, pin::Pin, time::Duration};

use super::models::{
    AccessToken, EmailCodeRequest, RefreshToken, RefreshTokenBinding, RegisteredClient,
    UpstreamLogin, UpstreamTokens,
};

/// Boxed future returning a token grant from the upstream provider.
pub type UpstreamTokensFuture<'a> =
    Pin<Box<dyn Future<Output = Result<UpstreamTokens, UpstreamGrantError>> + Send + 'a>>;

/// Why the upstream provider issued no tokens for a grant. Carries no
/// credential, so it is safe to log.
#[derive(Debug, thiserror::Error)]
pub enum UpstreamGrantError {
    /// The provider refused the code or refresh token itself as invalid,
    /// expired, or revoked. Only the user authorizing again fixes it.
    #[error("upstream refused the grant: {detail}")]
    InvalidGrant {
        /// The provider's reason, for logs.
        detail: String,
    },
    /// The provider was unreachable or throttling requests; retrying later
    /// can succeed.
    #[error("upstream is unavailable")]
    Unavailable {
        /// How long the provider asked callers to wait, when it said.
        retry_after: Option<Duration>,
    },
    /// Anything else: a request or client credential the provider rejected,
    /// which is ours to fix, or an answer we could not use.
    #[error("upstream grant request failed: {0:#}")]
    Failed(anyhow::Error),
}

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
    fn construct_authorize_url(
        &self,
        state: &str,
        login: UpstreamLogin<'_>,
    ) -> anyhow::Result<String>;

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

/// Boxed future returning an access token the broker minted.
pub type MintedAccessTokenFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<MintedAccessToken>> + Send + 'a>>;

/// A minted access token and how long it is valid, which a signer may cap
/// below the lifetime it was asked for.
pub struct MintedAccessToken {
    /// The signed token.
    pub token: AccessToken,
    /// How long it is valid for.
    pub lifetime: Duration,
}

/// Mints the token a resource that hands its bearer straight to Macro's APIs
/// gets in place of the upstream access token. Those APIs cannot look up which
/// client a token went to, so the token carries the attribution, signed.
pub trait MacroApiTokenMinter: Send + Sync {
    /// A Macro API token for the user `upstream` names, valid for at most
    /// `lifetime`,
    /// acting as the Macro bot via the client named `client_name` (`None` when
    /// its registration has lapsed).
    fn mint<'a>(
        &'a self,
        upstream: &'a AccessToken,
        client_name: Option<&'a str>,
        lifetime: Duration,
    ) -> MintedAccessTokenFuture<'a>;
}

/// Boxed future returning the upstream's answer to an emailed code request.
pub type EmailCodeRequestFuture<'a> =
    Pin<Box<dyn Future<Output = Result<EmailCodeRequest, EmailCodeError>> + Send + 'a>>;

/// Boxed future returning the tokens an emailed code redeems for.
pub type EmailCodeTokensFuture<'a> =
    Pin<Box<dyn Future<Output = Result<UpstreamTokens, EmailCodeError>> + Send + 'a>>;

/// Why the upstream refused or failed an emailed code step.
#[derive(Debug, thiserror::Error)]
pub enum EmailCodeError {
    /// The address is malformed.
    #[error("invalid email address")]
    InvalidEmail,
    /// The address may not sign in.
    #[error("email address may not sign in")]
    NotAllowed,
    /// The code is wrong or has expired.
    #[error("invalid or expired code")]
    InvalidCode,
    /// Too many attempts for this address.
    #[error("too many attempts")]
    RateLimited,
    /// The upstream could not be reached or answered unexpectedly.
    #[error("email sign-in is unavailable")]
    Unavailable(#[source] anyhow::Error),
}

/// Signs a user in with a one-time code sent to their email address.
///
/// Object-safe, like the other ports here, so the service holds it as a
/// trait object.
pub trait EmailCodeProvider: Send + Sync {
    /// Emails a sign-in code, or reports the single sign-on the address needs.
    fn request_code<'a>(&'a self, email: &'a str) -> EmailCodeRequestFuture<'a>;

    /// Redeems an emailed code for tokens.
    fn redeem_code<'a>(&'a self, email: &'a str, code: &'a str) -> EmailCodeTokensFuture<'a>;
}
