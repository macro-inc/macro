//! Service implementation for the MCP OAuth broker.

#[cfg(test)]
mod test;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    sync::Arc,
    time::{Duration, SystemTime},
};

use super::{
    models::{
        AuthorizeRequest, CallbackRequest, ClientRegistrationRequest, ClientRegistrationResponse,
        IssuedAuthorizationCode, PendingAuthorization, RefreshToken, RegisteredClient,
        TokenRequest, TokenResponse,
    },
    ports::{ClientRegistrationStore, OAuthProvider, RefreshTokenBindingStore},
    redirect_uri::RedirectUriPolicy,
};

pub(crate) const PENDING_AUTH_TTL: Duration = Duration::from_secs(10 * 60);
pub(crate) const AUTHORIZATION_CODE_TTL: Duration = Duration::from_secs(5 * 60);
/// How long a dynamic client registration survives without being used. Every
/// successful lookup extends it, so a client that keeps authorizing keeps its
/// registration and one that stops is eventually collected.
pub const CLIENT_REGISTRATION_TTL: Duration = Duration::from_secs(90 * 24 * 60 * 60);
/// How long a refresh token stays bound to its client. FusionAuth issues
/// refresh tokens on a 30-day sliding window and each broker refresh re-binds,
/// so a binding outlives every refresh token that can still be redeemed.
pub const REFRESH_TOKEN_BINDING_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// Redirect URIs accepted per registration. Enough for a client that offers
/// several callbacks, low enough that open registration cannot be used to
/// store unbounded data.
const MAX_REDIRECT_URIS_PER_CLIENT: usize = 8;
/// Longest redirect URI accepted at registration.
const MAX_REDIRECT_URI_LEN: usize = 512;

/// Domain interface for the MCP OAuth broker.
pub trait McpAuthProxyService: Clone + Send + Sync + 'static {
    /// Returns OAuth authorization server discovery metadata.
    fn authorization_server_metadata(&self) -> serde_json::Value;
    /// Returns protected-resource metadata for MCP clients.
    fn protected_resource_metadata(&self) -> serde_json::Value;
    /// Registers a public MCP client dynamically.
    fn register_client(
        &self,
        request: ClientRegistrationRequest,
    ) -> impl Future<Output = Result<ClientRegistrationResponse, RegisterClientError>> + Send;
    /// Starts an OAuth authorization flow and returns the upstream authorize URL.
    fn start_authorization(
        &self,
        params: AuthorizeRequest,
    ) -> impl Future<Output = Result<String, StartAuthorizationError>> + Send;
    /// Completes the upstream callback and returns the loopback redirect URL.
    fn complete_callback(
        &self,
        params: CallbackRequest,
    ) -> impl Future<Output = Result<String, CompleteCallbackError>> + Send;
    /// Exchanges a broker-issued code or refresh token for bearer credentials.
    fn exchange_token(
        &self,
        params: TokenRequest,
    ) -> impl Future<Output = Result<TokenResponse, TokenExchangeError>> + Send;
    /// Removes expired broker state when required by the backing store.
    fn cleanup_expired(&self) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Storage for short-lived in-flight OAuth handshake state.
pub trait InflightAuthStore: Send + Sync {
    /// Inserts a pending authorization flow keyed by broker session ID.
    fn insert_pending(
        &self,
        session_id: &str,
        pending: PendingAuthorization,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Removes and returns a pending authorization flow, if present.
    fn take_pending(
        &self,
        session_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<PendingAuthorization>>> + Send;

    /// Inserts a broker-issued authorization code.
    fn insert_issued(
        &self,
        code: &str,
        issued: IssuedAuthorizationCode,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Removes and returns a broker-issued authorization code, if present.
    fn take_issued(
        &self,
        code: &str,
    ) -> impl Future<Output = anyhow::Result<Option<IssuedAuthorizationCode>>> + Send;

    /// Removes expired entries when the backing store requires manual cleanup.
    fn cleanup_expired(&self) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Dependencies and policy required to build the broker service.
pub struct McpAuthProxyServiceDeps<I> {
    /// Public base URL the broker is served from.
    pub public_url: String,
    /// The redirect URI destinations this deployment trusts.
    pub redirect_uri_policy: RedirectUriPolicy,
    /// Store for short-lived handshake state.
    pub inflight_auth: Arc<I>,
    /// Store for dynamically registered clients.
    pub client_registrations: Arc<dyn ClientRegistrationStore>,
    /// Store binding refresh tokens to the clients that obtained them.
    pub refresh_token_bindings: Arc<dyn RefreshTokenBindingStore>,
    /// Upstream OAuth provider the broker fronts.
    pub oauth_provider: Arc<dyn OAuthProvider>,
}

/// Domain service backing the MCP OAuth broker.
pub struct McpAuthProxyServiceImpl<I> {
    inflight_auth: Arc<I>,
    client_registrations: Arc<dyn ClientRegistrationStore>,
    refresh_token_bindings: Arc<dyn RefreshTokenBindingStore>,
    oauth_provider: Arc<dyn OAuthProvider>,
    redirect_uri_policy: RedirectUriPolicy,
    public_url: String,
}

impl<I> Clone for McpAuthProxyServiceImpl<I> {
    fn clone(&self) -> Self {
        Self {
            inflight_auth: Arc::clone(&self.inflight_auth),
            client_registrations: Arc::clone(&self.client_registrations),
            refresh_token_bindings: Arc::clone(&self.refresh_token_bindings),
            oauth_provider: Arc::clone(&self.oauth_provider),
            redirect_uri_policy: self.redirect_uri_policy.clone(),
            public_url: self.public_url.clone(),
        }
    }
}

impl<I> McpAuthProxyServiceImpl<I>
where
    I: InflightAuthStore + 'static,
{
    /// Creates a new auth proxy service backed by an upstream OAuth provider.
    pub fn new(deps: McpAuthProxyServiceDeps<I>) -> Self {
        let McpAuthProxyServiceDeps {
            public_url,
            redirect_uri_policy,
            inflight_auth,
            client_registrations,
            refresh_token_bindings,
            oauth_provider,
        } = deps;

        Self {
            inflight_auth,
            client_registrations,
            refresh_token_bindings,
            oauth_provider,
            redirect_uri_policy,
            public_url,
        }
    }

    /// Refreshes an upstream token for the client the refresh token belongs to.
    ///
    /// A public client has no credential to present, so the binding recorded
    /// when the token was issued is what ties the grant to a client. Rotating
    /// the binding on every refresh means a replayed token whose binding has
    /// already moved on finds nothing and is refused.
    async fn refresh_token_exchange(
        &self,
        params: TokenRequest,
    ) -> Result<TokenResponse, TokenExchangeError> {
        let client_id = params
            .client_id
            .ok_or(TokenExchangeError::ClientIdRequired)?;
        let refresh_token = params
            .refresh_token
            .ok_or(TokenExchangeError::RefreshTokenRequired)?;

        let presented_digest = refresh_token_digest(&refresh_token);
        let bound_client_id = self
            .refresh_token_bindings
            .bound_client(&presented_digest)
            .await
            .map_err(TokenExchangeError::RefreshTokenBindingStore)?
            .ok_or(TokenExchangeError::UnboundRefreshToken)?;

        if bound_client_id != client_id {
            tracing::warn!(
                %client_id,
                "refresh token presented by a client it was not issued to"
            );
            return Err(TokenExchangeError::ClientMismatch);
        }

        let tokens = self
            .oauth_provider
            .refresh_access_token(&refresh_token)
            .await
            .map_err(TokenExchangeError::RefreshFailed)?;

        let rotated_digest = refresh_token_digest(&tokens.refresh_token);
        // The upstream token is already issued at this point. A binding write
        // that fails costs the client its next refresh, which it recovers from
        // by authorizing again; discarding a token the user just approved
        // costs them the session outright. So log and hand the token over.
        let rebound = self
            .refresh_token_bindings
            .bind(&rotated_digest, &client_id)
            .await
            .inspect_err(|error| {
                tracing::error!(error=?error, %client_id, "failed to bind rotated refresh token");
            })
            .is_ok();

        if rebound && rotated_digest != presented_digest {
            self.refresh_token_bindings
                .unbind(&presented_digest)
                .await
                .unwrap_or_else(|error| {
                    tracing::error!(
                        error=?error,
                        %client_id,
                        "failed to drop superseded refresh token binding"
                    );
                });
        }

        Ok(TokenResponse {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_type: "Bearer",
            expires_in: Some(tokens.expires_in),
        })
    }

    async fn exchange_authorization_code_token(
        &self,
        params: TokenRequest,
    ) -> Result<TokenResponse, TokenExchangeError> {
        // Read the client id before consuming the code, so a malformed request
        // does not spend a code that is still good.
        let client_id = params
            .client_id
            .as_deref()
            .ok_or(TokenExchangeError::ClientIdRequired)?;

        let issued = self
            .inflight_auth
            .take_issued(
                params
                    .code
                    .as_deref()
                    .ok_or(TokenExchangeError::CodeRequired)?,
            )
            .await
            .map_err(TokenExchangeError::InflightStore)?
            .ok_or(TokenExchangeError::InvalidOrExpiredCode)?;

        if client_id != issued.client_id {
            tracing::warn!(
                presented_client_id = %client_id,
                issued_client_id = %issued.client_id,
                "authorization code redeemed by a client it was not issued to"
            );
            return Err(TokenExchangeError::ClientMismatch);
        }

        match &params.redirect_uri {
            Some(uri) if *uri != issued.redirect_uri => {
                return Err(TokenExchangeError::RedirectUriMismatch);
            }
            None => return Err(TokenExchangeError::RedirectUriRequired),
            _ => {}
        }

        match params.code_verifier {
            Some(verifier) => {
                let digest = Sha256::digest(verifier.as_bytes());
                let computed = URL_SAFE_NO_PAD.encode(digest);
                if computed != issued.code_challenge {
                    return Err(TokenExchangeError::PkceVerificationFailed);
                }
            }
            None => return Err(TokenExchangeError::CodeVerifierRequired),
        }

        self.refresh_token_bindings
            .bind(
                &refresh_token_digest(&issued.refresh_token),
                &issued.client_id,
            )
            .await
            .map_err(TokenExchangeError::RefreshTokenBindingStore)?;

        Ok(TokenResponse {
            access_token: issued.access_token,
            refresh_token: issued.refresh_token,
            token_type: "Bearer",
            expires_in: issued.access_token_expires_at.map(seconds_until),
        })
    }
}

impl<I> McpAuthProxyService for McpAuthProxyServiceImpl<I>
where
    I: InflightAuthStore + 'static,
{
    /// Authorization server discovery metadata.
    fn authorization_server_metadata(&self) -> serde_json::Value {
        tracing::debug!("oauth-authorization-server metadata requested");
        let base = &self.public_url;
        serde_json::json!({
            "issuer": base,
            "authorization_endpoint": format!("{base}/authorize"),
            "token_endpoint": format!("{base}/token"),
            "registration_endpoint": format!("{base}/register"),
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
        })
    }

    /// Protected resource metadata for MCP clients.
    fn protected_resource_metadata(&self) -> serde_json::Value {
        tracing::debug!("oauth-protected-resource metadata requested");
        let base = &self.public_url;
        serde_json::json!({
            "authorization_server": base,
            "authorization_servers": [base],
        })
    }

    /// Handles dynamic client registration for public MCP clients.
    ///
    /// Registration is open, as MCP clients require, but it is not
    /// unconstrained: every submitted redirect URI must satisfy the
    /// deployment's redirect URI policy, and the accepted set is persisted so
    /// later authorize requests have something to be checked against.
    async fn register_client(
        &self,
        request: ClientRegistrationRequest,
    ) -> Result<ClientRegistrationResponse, RegisterClientError> {
        if request.redirect_uris.is_empty() {
            return Err(RegisterClientError::RedirectUrisRequired);
        }
        if request.redirect_uris.len() > MAX_REDIRECT_URIS_PER_CLIENT {
            return Err(RegisterClientError::TooManyRedirectUris);
        }
        for uri in &request.redirect_uris {
            if uri.len() > MAX_REDIRECT_URI_LEN || !self.redirect_uri_policy.permits(uri) {
                return Err(RegisterClientError::UnsupportedRedirectUri { uri: uri.clone() });
            }
        }

        let client = RegisteredClient {
            client_id: uuid::Uuid::new_v4().to_string(),
            client_name: request
                .client_name
                .unwrap_or_else(|| "mcp-client".to_owned()),
            redirect_uris: request.redirect_uris,
        };

        self.client_registrations
            .insert_client(&client)
            .await
            .map_err(RegisterClientError::ClientRegistrationStore)?;

        tracing::info!(
            client_id = %client.client_id,
            client_name = %client.client_name,
            redirect_uris = ?client.redirect_uris,
            "dynamic client registration"
        );

        Ok(ClientRegistrationResponse {
            client_id: client.client_id,
            client_name: client.client_name,
            redirect_uris: client.redirect_uris,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
        })
    }

    /// Starts an OAuth authorization flow and returns the upstream authorize URL.
    fn start_authorization(
        &self,
        params: AuthorizeRequest,
    ) -> impl Future<Output = Result<String, StartAuthorizationError>> + Send {
        let service = self.clone();
        async move {
            if params.response_type != "code" {
                return Err(StartAuthorizationError::UnsupportedResponseType);
            }
            if params.code_challenge_method != "S256" {
                return Err(StartAuthorizationError::UnsupportedCodeChallengeMethod);
            }
            // Applied ahead of the registered set so a registration made
            // before the policy was narrowed cannot still be used.
            if !service.redirect_uri_policy.permits(&params.redirect_uri) {
                return Err(StartAuthorizationError::InvalidRedirectUri);
            }

            let client = service
                .client_registrations
                .find_client(&params.client_id)
                .await
                .map_err(StartAuthorizationError::ClientRegistrationStore)?
                .ok_or(StartAuthorizationError::UnknownClient)?;

            if !client.permits_redirect_uri(&params.redirect_uri) {
                tracing::warn!(
                    client_id = %params.client_id,
                    "authorize request used a redirect_uri the client did not register"
                );
                return Err(StartAuthorizationError::UnregisteredRedirectUri);
            }

            let session_id = uuid::Uuid::new_v4().to_string();
            tracing::info!(%session_id, client_id = %client.client_id, "starting OAuth authorize flow");

            service
                .inflight_auth
                .insert_pending(
                    &session_id,
                    PendingAuthorization {
                        client_id: client.client_id,
                        code_challenge: params.code_challenge,
                        client_state: params.state,
                        client_redirect_uri: params.redirect_uri,
                    },
                )
                .await
                .map_err(StartAuthorizationError::InflightStore)?;

            service
                .oauth_provider
                .construct_authorize_url(&session_id)
                .map_err(StartAuthorizationError::ConstructAuthorizeUrl)
        }
    }

    /// Completes the upstream OAuth callback and returns the redirect URL for
    /// the MCP client loopback callback.
    async fn complete_callback(
        &self,
        params: CallbackRequest,
    ) -> Result<String, CompleteCallbackError> {
        let session_id = params
            .state
            .as_deref()
            .map(|state| state.trim_matches('"').to_string())
            .ok_or(CompleteCallbackError::MissingState)?;

        tracing::info!(%session_id, "oauth callback received");

        let pending = self
            .inflight_auth
            .take_pending(&session_id)
            .await
            .map_err(CompleteCallbackError::InflightStore)?
            .ok_or(CompleteCallbackError::UnknownOrExpiredSession)?;

        if let Some(error) = params.error {
            tracing::warn!(
                %session_id,
                %error,
                description = ?params.error_description,
                "upstream oauth returned error"
            );
            let mut params_to_append =
                vec![("error", error), ("state", pending.client_state.clone())];
            if let Some(desc) = params.error_description {
                params_to_append.push(("error_description", desc));
            }
            return Ok(append_query_params(
                &pending.client_redirect_uri,
                &params_to_append,
            ));
        }

        let code = params.code.ok_or(CompleteCallbackError::MissingCode)?;

        let tokens = self
            .oauth_provider
            .exchange_authorization_code(&code)
            .await
            .map_err(CompleteCallbackError::AuthorizationCodeExchangeFailed)?;

        // The client may sit on the broker code for up to `AUTHORIZATION_CODE_TTL`
        // before redeeming it, so record when the upstream token actually expires
        // and count down from that at token exchange rather than replaying a stale
        // `expires_in`.
        let access_token_expires_at =
            SystemTime::now().checked_add(Duration::from_secs(tokens.expires_in));

        let issued_code = uuid::Uuid::new_v4().to_string();
        self.inflight_auth
            .insert_issued(
                &issued_code,
                IssuedAuthorizationCode {
                    client_id: pending.client_id,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    code_challenge: pending.code_challenge,
                    redirect_uri: pending.client_redirect_uri.clone(),
                    access_token_expires_at,
                },
            )
            .await
            .map_err(CompleteCallbackError::InflightStore)?;

        Ok(append_query_params(
            &pending.client_redirect_uri,
            &[
                ("code", issued_code),
                ("state", pending.client_state.clone()),
            ],
        ))
    }

    /// Exchanges a broker-issued authorization code for an upstream bearer
    /// token after verifying redirect URI and PKCE.
    async fn exchange_token(
        &self,
        params: TokenRequest,
    ) -> Result<TokenResponse, TokenExchangeError> {
        match params.grant_type.as_str() {
            "authorization_code" => self.exchange_authorization_code_token(params).await,
            "refresh_token" => self.refresh_token_exchange(params).await,
            _ => Err(TokenExchangeError::UnsupportedGrantType),
        }
    }

    /// Removes expired pending sessions and broker-issued codes.
    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        self.inflight_auth.cleanup_expired().await
    }
}

/// Seconds from now until `deadline`, saturating at zero for a deadline that
/// has already passed.
fn seconds_until(deadline: SystemTime) -> u64 {
    deadline
        .duration_since(SystemTime::now())
        .map(|remaining| remaining.as_secs())
        .unwrap_or(0)
}

/// Digest used to key a refresh token binding, so the store never holds a
/// token that could be replayed if it were read.
fn refresh_token_digest(refresh_token: &RefreshToken) -> String {
    let digest = Sha256::digest(refresh_token.as_str().as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/// Appends query parameters to a redirect URI, keeping any query the client
/// registered on it.
fn append_query_params(uri: &str, params: &[(&str, String)]) -> String {
    let mut redirect = uri.to_owned();
    let mut separator = if uri.contains('?') { '&' } else { '?' };
    for (key, value) in params {
        redirect.push(separator);
        redirect.push_str(key);
        redirect.push('=');
        redirect.push_str(&urlencoding::encode(value));
        separator = '&';
    }
    redirect
}

/// Errors returned when registering a client.
#[derive(Debug, thiserror::Error)]
pub enum RegisterClientError {
    /// A client with no redirect URI could never complete a flow.
    #[error("at least one redirect_uri is required")]
    RedirectUrisRequired,
    /// More redirect URIs than the broker will store for one client.
    #[error("too many redirect_uris")]
    TooManyRedirectUris,
    /// A submitted redirect URI is not a destination this deployment trusts.
    #[error("redirect_uri is not an allowed destination")]
    UnsupportedRedirectUri {
        /// The rejected URI, for logging.
        uri: String,
    },
    /// The registration could not be persisted.
    #[error("failed to persist client registration")]
    ClientRegistrationStore(anyhow::Error),
}

/// Errors returned when starting authorization.
#[derive(Debug, thiserror::Error)]
pub enum StartAuthorizationError {
    /// Only authorization code flows are supported.
    #[error("unsupported response_type")]
    UnsupportedResponseType,
    /// Only S256 PKCE is supported.
    #[error("unsupported code_challenge_method")]
    UnsupportedCodeChallengeMethod,
    /// The redirect URI is not a destination this deployment trusts.
    #[error("redirect_uri is not an allowed destination")]
    InvalidRedirectUri,
    /// The redirect URI is not one this client registered.
    #[error("redirect_uri was not registered for this client")]
    UnregisteredRedirectUri,
    /// The client_id has no live registration.
    #[error("unknown client_id")]
    UnknownClient,
    /// Client registrations could not be read.
    #[error("failed to read client registrations")]
    ClientRegistrationStore(anyhow::Error),
    /// Inflight auth state could not be persisted.
    #[error("failed to persist inflight auth state")]
    InflightStore(anyhow::Error),
    /// Upstream authorize URL construction failed.
    #[error("failed to construct authorize URL")]
    ConstructAuthorizeUrl(anyhow::Error),
}

/// Errors returned when handling the upstream callback.
#[derive(Debug, thiserror::Error)]
pub enum CompleteCallbackError {
    /// Upstream callback omitted state.
    #[error("missing state parameter")]
    MissingState,
    /// Upstream callback omitted both the authorization code and an error code.
    #[error("missing code parameter")]
    MissingCode,
    /// Pending broker session was missing or expired.
    #[error("unknown or expired session")]
    UnknownOrExpiredSession,
    /// Inflight auth state could not be loaded or updated.
    #[error("failed to access inflight auth state")]
    InflightStore(anyhow::Error),
    /// Upstream code exchange failed.
    #[error("authorization code exchange failed")]
    AuthorizationCodeExchangeFailed(anyhow::Error),
}

/// Errors returned when exchanging a broker-issued code for a bearer token.
#[derive(Debug, thiserror::Error)]
pub enum TokenExchangeError {
    /// Only authorization code exchanges are supported.
    #[error("unsupported grant_type")]
    UnsupportedGrantType,
    /// Authorization code is required for authorization_code grants.
    #[error("code required")]
    CodeRequired,
    /// Broker-issued code was missing or already used.
    #[error("invalid or expired code")]
    InvalidOrExpiredCode,
    /// Redirect URI did not match the authorization request.
    #[error("redirect_uri mismatch")]
    RedirectUriMismatch,
    /// Redirect URI must be provided for token exchange.
    #[error("redirect_uri required")]
    RedirectUriRequired,
    /// PKCE verifier was missing.
    #[error("code_verifier required")]
    CodeVerifierRequired,
    /// PKCE verification failed.
    #[error("PKCE verification failed")]
    PkceVerificationFailed,
    /// Refresh token is required for refresh_token grants.
    #[error("refresh_token required")]
    RefreshTokenRequired,
    /// The client_id was absent from the token request.
    #[error("client_id required")]
    ClientIdRequired,
    /// The grant was issued to a different client than the one presenting it.
    #[error("grant was not issued to this client")]
    ClientMismatch,
    /// The refresh token has no recorded client binding, so the broker cannot
    /// tell which client it belongs to.
    #[error("refresh token is not bound to a client")]
    UnboundRefreshToken,
    /// Inflight auth state could not be loaded or updated.
    #[error("failed to access inflight auth state")]
    InflightStore(anyhow::Error),
    /// Refresh token bindings could not be read or written.
    #[error("failed to access refresh token bindings")]
    RefreshTokenBindingStore(anyhow::Error),
    /// Upstream refresh failed.
    #[error("refresh token exchange failed")]
    RefreshFailed(anyhow::Error),
}
