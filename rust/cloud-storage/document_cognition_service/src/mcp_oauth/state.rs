use dashmap::DashMap;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use std::sync::Arc;
use std::time::Instant;

/// A pending OAuth authorization flow initiated by the client.
#[derive(Clone)]
pub struct PendingAuthFlow {
    /// PKCE S256 code challenge from the client.
    pub code_challenge: String,
    /// The client's original `state` parameter.
    pub client_state: String,
    /// Where to redirect back to the client with the authorization code.
    pub client_redirect_uri: String,
    /// When this flow expires (TTL ~10 min).
    pub expires_at: Instant,
}

/// An authorization code we issued, backed by a validated JWT.
#[derive(Clone)]
pub struct IssuedCode {
    /// The access token (JWT) obtained from FusionAuth.
    pub access_token: String,
    /// The original PKCE code challenge, for verification at token exchange.
    pub code_challenge: String,
    /// The `redirect_uri` used in the authorization request, for validation at
    /// token exchange per OAuth 2.1 §4.1.3.
    pub redirect_uri: String,
    /// When this code expires (TTL ~5 min).
    pub expires_at: Instant,
}

/// Shared state for the OAuth proxy.
///
/// The DashMaps are wrapped in `Arc` so that axum's state cloning shares the
/// same underlying maps across all handlers.
#[derive(Clone)]
pub struct OAuthState {
    /// Pending authorization flows, keyed by session ID.
    pub pending: Arc<DashMap<String, PendingAuthFlow>>,
    /// Issued authorization codes, keyed by the code string.
    pub codes: Arc<DashMap<String, IssuedCode>>,
    /// JWT validation args (shared with the `/mcp` Bearer middleware).
    pub jwt_args: JwtValidationArgs,
    /// FusionAuth client for OAuth2 authorization code grant.
    pub fusionauth_client: Arc<fusionauth::FusionAuthClient>,
    /// The Google identity provider ID in FusionAuth, used as `idp_hint`.
    pub google_idp_id: String,
    /// Externally-reachable URL of this MCP server (e.g. `http://localhost:8090`).
    pub mcp_public_url: String,
}

impl OAuthState {
    /// Remove expired entries from both maps.
    pub fn cleanup_expired(&self) {
        let now = Instant::now();
        self.pending.retain(|_, v| v.expires_at > now);
        self.codes.retain(|_, v| v.expires_at > now);
    }
}
