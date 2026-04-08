//! Service implementation for the MCP OAuth broker.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use dashmap::DashMap;
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use super::{
    models::{
        AuthorizeRequest, CallbackRequest, IssuedAuthorizationCode, PendingAuthorization,
        RefreshCredentials, RefreshToken, TokenRequest, TokenResponse,
    },
    ports::OAuthProvider,
};

const PENDING_AUTH_TTL: Duration = Duration::from_secs(10 * 60);
const AUTHORIZATION_CODE_TTL: Duration = Duration::from_secs(5 * 60);
const REFRESH_CREDENTIAL_TTL: Duration = Duration::from_secs(60 * 60 * 24 * 30);

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
    ) -> Result<String, StartAuthorizationError>;
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
    /// Removes expired broker state from in-memory storage.
    fn cleanup_expired(&self);
}

/// Domain service backing the MCP OAuth broker.
#[derive(Clone)]
pub struct McpAuthProxyServiceImpl {
    pending: Arc<DashMap<String, PendingAuthorization>>,
    codes: Arc<DashMap<String, IssuedAuthorizationCode>>,
    refresh_credentials: Arc<DashMap<RefreshToken, RefreshCredentials>>,
    oauth_provider: Arc<dyn OAuthProvider>,
    public_url: String,
}

impl McpAuthProxyServiceImpl {
    /// Creates a new auth proxy service backed by an upstream OAuth provider.
    pub fn new(public_url: String, oauth_provider: Arc<dyn OAuthProvider>) -> Self {
        Self {
            pending: Arc::new(DashMap::new()),
            codes: Arc::new(DashMap::new()),
            refresh_credentials: Arc::new(DashMap::new()),
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

        let existing = self
            .refresh_credentials
            .remove(&refresh_token)
            .map(|(_, credentials)| credentials)
            .ok_or(TokenExchangeError::InvalidRefreshToken)?;

        if existing.expires_at < Instant::now() {
            return Err(TokenExchangeError::InvalidRefreshToken);
        }

        let (access_token, new_refresh_token) = self
            .oauth_provider
            .refresh_access_token(&existing.access_token, &refresh_token)
            .await
            .map_err(TokenExchangeError::RefreshFailed)?;

        self.refresh_credentials.insert(
            new_refresh_token.clone(),
            RefreshCredentials {
                access_token: access_token.clone(),
                expires_at: Instant::now() + REFRESH_CREDENTIAL_TTL,
            },
        );

        Ok(TokenResponse {
            access_token,
            refresh_token: new_refresh_token,
            token_type: "Bearer",
        })
    }

    fn exchange_authorization_code_token(
        &self,
        params: TokenRequest,
    ) -> Result<TokenResponse, TokenExchangeError> {
        let issued = self
            .codes
            .remove(
                params
                    .code
                    .as_deref()
                    .ok_or(TokenExchangeError::CodeRequired)?,
            )
            .map(|(_, code)| code)
            .ok_or(TokenExchangeError::InvalidOrExpiredCode)?;

        if issued.expires_at < Instant::now() {
            return Err(TokenExchangeError::CodeExpired);
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

        let access_token = issued.access_token;
        let refresh_token = issued.refresh_token;
        self.refresh_credentials.insert(
            refresh_token.clone(),
            RefreshCredentials {
                access_token: access_token.clone(),
                expires_at: Instant::now() + REFRESH_CREDENTIAL_TTL,
            },
        );

        Ok(TokenResponse {
            access_token,
            refresh_token,
            token_type: "Bearer",
        })
    }
}

impl McpAuthProxyService for McpAuthProxyServiceImpl {
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
    ) -> Result<String, StartAuthorizationError> {
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

        self.pending.insert(
            session_id.clone(),
            PendingAuthorization {
                code_challenge: params.code_challenge,
                client_state: params.state,
                client_redirect_uri: params.redirect_uri,
                expires_at: Instant::now() + PENDING_AUTH_TTL,
            },
        );

        self.oauth_provider
            .construct_authorize_url(&session_id)
            .map_err(StartAuthorizationError::ConstructAuthorizeUrl)
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

        tracing::info!(
            %session_id,
            pending_count = self.pending.len(),
            "oauth callback received"
        );

        let pending = self
            .pending
            .remove(&session_id)
            .map(|(_, pending)| pending)
            .ok_or(CompleteCallbackError::UnknownOrExpiredSession)?;

        let (access_token, refresh_token) = self
            .oauth_provider
            .exchange_authorization_code(&params.code)
            .await
            .map_err(CompleteCallbackError::AuthorizationCodeExchangeFailed)?;

        let issued_code = uuid::Uuid::new_v4().to_string();
        self.codes.insert(
            issued_code.clone(),
            IssuedAuthorizationCode {
                access_token,
                refresh_token,
                code_challenge: pending.code_challenge,
                redirect_uri: pending.client_redirect_uri.clone(),
                expires_at: Instant::now() + AUTHORIZATION_CODE_TTL,
            },
        );

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
            "authorization_code" => self.exchange_authorization_code_token(params),
            "refresh_token" => self.refresh_token_exchange(params).await,
            _ => Err(TokenExchangeError::UnsupportedGrantType),
        }
    }

    /// Removes expired pending sessions and broker-issued codes.
    fn cleanup_expired(&self) {
        let now = Instant::now();
        self.pending.retain(|_, value| value.expires_at > now);
        self.codes.retain(|_, value| value.expires_at > now);
        self.refresh_credentials
            .retain(|_, value| value.expires_at > now);
    }
}

fn is_allowed_redirect_uri(uri: &str) -> bool {
    let Ok(parsed) = url::Url::parse(uri) else {
        return false;
    };

    matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
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
    /// Only loopback redirect URIs are allowed.
    #[error("redirect_uri must be a loopback address")]
    InvalidRedirectUri,
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
    /// Pending broker session was missing or expired.
    #[error("unknown or expired session")]
    UnknownOrExpiredSession,
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
    /// Broker-issued code expired.
    #[error("code expired")]
    CodeExpired,
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
    /// Refresh token was missing, expired, or unknown to the broker.
    #[error("invalid refresh token")]
    InvalidRefreshToken,
    /// Upstream refresh failed.
    #[error("refresh token exchange failed")]
    RefreshFailed(anyhow::Error),
}
