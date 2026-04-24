//! Service implementation for the MCP OAuth broker.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::{future::Future, sync::Arc, time::Duration};

use super::{
    models::{
        AuthorizeRequest, CallbackRequest, IssuedAuthorizationCode, PendingAuthorization,
        TokenRequest, TokenResponse,
    },
    ports::OAuthProvider,
};

pub(crate) const PENDING_AUTH_TTL: Duration = Duration::from_secs(10 * 60);
pub(crate) const AUTHORIZATION_CODE_TTL: Duration = Duration::from_secs(5 * 60);

/// Domain interface for the MCP OAuth broker.
pub trait McpAuthProxyService: Clone + Send + Sync + 'static {
    /// Returns OAuth authorization server discovery metadata.
    fn authorization_server_metadata(&self) -> serde_json::Value;
    /// Returns protected-resource metadata for MCP clients.
    fn protected_resource_metadata(&self) -> serde_json::Value;
    /// Registers a public MCP client dynamically.
    fn register_client(&self, body: serde_json::Value) -> serde_json::Value;
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

/// Domain service backing the MCP OAuth broker.
pub struct McpAuthProxyServiceImpl<I> {
    inflight_auth: Arc<I>,
    oauth_provider: Arc<dyn OAuthProvider>,
    public_url: String,
}

impl<I> Clone for McpAuthProxyServiceImpl<I> {
    fn clone(&self) -> Self {
        Self {
            inflight_auth: Arc::clone(&self.inflight_auth),
            oauth_provider: Arc::clone(&self.oauth_provider),
            public_url: self.public_url.clone(),
        }
    }
}

impl<I> McpAuthProxyServiceImpl<I>
where
    I: InflightAuthStore + 'static,
{
    /// Creates a new auth proxy service backed by an upstream OAuth provider.
    pub fn new(
        public_url: String,
        inflight_auth: Arc<I>,
        oauth_provider: Arc<dyn OAuthProvider>,
    ) -> Self {
        Self {
            inflight_auth,
            oauth_provider,
            public_url,
        }
    }

    async fn refresh_token_exchange(
        &self,
        params: TokenRequest,
    ) -> Result<TokenResponse, TokenExchangeError> {
        let refresh_token = params
            .refresh_token
            .ok_or(TokenExchangeError::RefreshTokenRequired)?;

        let (access_token, new_refresh_token) = self
            .oauth_provider
            .refresh_access_token(&refresh_token)
            .await
            .map_err(TokenExchangeError::RefreshFailed)?;

        Ok(TokenResponse {
            access_token,
            refresh_token: new_refresh_token,
            token_type: "Bearer",
        })
    }

    async fn exchange_authorization_code_token(
        &self,
        params: TokenRequest,
    ) -> Result<TokenResponse, TokenExchangeError> {
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

        Ok(TokenResponse {
            access_token: issued.access_token,
            refresh_token: issued.refresh_token,
            token_type: "Bearer",
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
    fn register_client(&self, body: serde_json::Value) -> serde_json::Value {
        let client_id = uuid::Uuid::new_v4().to_string();
        let client_name = body
            .get("client_name")
            .and_then(|v| v.as_str())
            .unwrap_or("mcp-client");

        tracing::info!(%client_id, %client_name, "dynamic client registration");

        serde_json::json!({
            "client_id": client_id,
            "client_name": client_name,
            "redirect_uris": body.get("redirect_uris").cloned().unwrap_or(serde_json::json!([])),
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
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
            if !is_allowed_redirect_uri(&params.redirect_uri) {
                return Err(StartAuthorizationError::InvalidRedirectUri);
            }

            let session_id = uuid::Uuid::new_v4().to_string();
            tracing::info!(%session_id, "starting OAuth authorize flow");

            service
                .inflight_auth
                .insert_pending(
                    &session_id,
                    PendingAuthorization {
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
            let mut redirect = format!(
                "{}?error={}&state={}",
                pending.client_redirect_uri,
                urlencoding::encode(&error),
                urlencoding::encode(&pending.client_state),
            );
            if let Some(desc) = params.error_description {
                redirect.push_str(&format!(
                    "&error_description={}",
                    urlencoding::encode(&desc)
                ));
            }
            return Ok(redirect);
        }

        let code = params.code.ok_or(CompleteCallbackError::MissingCode)?;

        let (access_token, refresh_token) = self
            .oauth_provider
            .exchange_authorization_code(&code)
            .await
            .map_err(CompleteCallbackError::AuthorizationCodeExchangeFailed)?;

        let issued_code = uuid::Uuid::new_v4().to_string();
        self.inflight_auth
            .insert_issued(
                &issued_code,
                IssuedAuthorizationCode {
                    access_token,
                    refresh_token,
                    code_challenge: pending.code_challenge,
                    redirect_uri: pending.client_redirect_uri.clone(),
                },
            )
            .await
            .map_err(CompleteCallbackError::InflightStore)?;

        Ok(format!(
            "{}?code={}&state={}",
            pending.client_redirect_uri,
            urlencoding::encode(&issued_code),
            urlencoding::encode(&pending.client_state),
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

fn is_allowed_redirect_uri(uri: &str) -> bool {
    let Ok(parsed) = url::Url::parse(uri) else {
        return false;
    };

    if parsed.scheme() == "https" {
        return true;
    }

    if parsed.scheme() == "http" {
        return matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    }

    false
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
    /// Only https or loopback http redirect URIs are allowed.
    #[error("redirect_uri must be https or a loopback address")]
    InvalidRedirectUri,
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
    /// Inflight auth state could not be loaded or updated.
    #[error("failed to access inflight auth state")]
    InflightStore(anyhow::Error),
    /// Upstream refresh failed.
    #[error("refresh token exchange failed")]
    RefreshFailed(anyhow::Error),
}
