use axum::{
    extract::{Query, State},
    response::{IntoResponse, Json, Redirect, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

use super::state::OAuthState;

// ── 1. Discovery ────────────────────────────────────────────────────────

/// `GET /.well-known/oauth-authorization-server`
pub async fn metadata(State(state): State<OAuthState>) -> Json<serde_json::Value> {
    tracing::debug!("oauth-authorization-server metadata requested");
    let base = &state.mcp_public_url;
    Json(serde_json::json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/authorize"),
        "token_endpoint": format!("{base}/token"),
        "registration_endpoint": format!("{base}/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
    }))
}

// ── 1b. Dynamic Client Registration (RFC 7591) ─────────────────────────

/// `POST /register` — accepts a dynamic client registration request and returns
/// a new client_id. Since we proxy all auth through FusionAuth and use PKCE,
/// we don't need real client credentials — we just mint a unique client_id.
pub async fn register(axum::Json(body): axum::Json<serde_json::Value>) -> Response {
    let client_id = uuid::Uuid::new_v4().to_string();
    let client_name = body
        .get("client_name")
        .and_then(|v| v.as_str())
        .unwrap_or("mcp-client");

    tracing::info!(%client_id, %client_name, "dynamic client registration");

    Json(serde_json::json!({
        "client_id": client_id,
        "client_name": client_name,
        "redirect_uris": body.get("redirect_uris").cloned().unwrap_or(serde_json::json!([])),
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }))
    .into_response()
}

// ── 2. Authorize ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AuthorizeParams {
    response_type: String,
    #[allow(dead_code)]
    client_id: String,
    redirect_uri: String,
    state: String,
    code_challenge: String,
    code_challenge_method: String,
    #[serde(default)]
    #[allow(dead_code)]
    scope: Option<String>,
}

/// Returns `true` if the redirect URI is acceptable.
///
/// We allow loopback addresses (with any port) and `http://localhost` variants,
/// which covers MCP clients like Claude Desktop that spin up a local callback
/// server. All other origins are rejected to prevent open-redirect attacks.
fn is_allowed_redirect_uri(uri: &str) -> bool {
    let Ok(parsed) = url::Url::parse(uri) else {
        return false;
    };

    matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
}

/// `GET /authorize` — validates params, stores the pending flow, then redirects
/// to FusionAuth's `/oauth2/authorize` endpoint with the Google IDP hint. After
/// the user logs in, FusionAuth redirects back to our `/oauth/callback` with an
/// authorization code.
pub async fn authorize(
    State(oauth): State<OAuthState>,
    Query(params): Query<AuthorizeParams>,
) -> Response {
    if params.response_type != "code" {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported response_type",
        )
            .into_response();
    }
    if params.code_challenge_method != "S256" {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported code_challenge_method",
        )
            .into_response();
    }
    if !is_allowed_redirect_uri(&params.redirect_uri) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "redirect_uri must be a loopback address",
        )
            .into_response();
    }

    // Generate a session ID to correlate the callback.
    let session_id = uuid::Uuid::new_v4().to_string();
    tracing::info!(%session_id, "starting OAuth authorize flow");

    oauth.pending.insert(
        session_id.clone(),
        super::state::PendingAuthFlow {
            code_challenge: params.code_challenge,
            client_state: params.state,
            client_redirect_uri: params.redirect_uri,
            expires_at: Instant::now() + Duration::from_secs(600),
        },
    );

    // Build the FusionAuth authorize URL with the Google IDP hint.
    // The session_id is threaded through FusionAuth's `state` parameter so we
    // can correlate the callback.
    let fusionauth_url = match oauth.fusionauth_client.construct_oauth2_authorize_url(
        &oauth.google_idp_id,
        None,
        Some(session_id),
    ) {
        Ok(url) => url,
        Err(e) => {
            tracing::error!(error=?e, "failed to construct FusionAuth authorize URL");
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to construct authorize URL",
            )
                .into_response();
        }
    };

    Redirect::temporary(&fusionauth_url).into_response()
}

// ── 3. OAuth callback (FusionAuth → us via redirect) ─────────────────────

#[derive(Deserialize)]
pub struct CallbackParams {
    /// Authorization code from FusionAuth.
    code: String,
    /// Our session ID, threaded through FusionAuth's `state` parameter.
    state: Option<String>,
}

/// `GET /oauth/callback` — FusionAuth redirects here after the user logs in
/// via Google. The `code` query param is a FusionAuth authorization code that
/// we exchange for a JWT by calling FusionAuth's `POST /oauth2/token` endpoint.
pub async fn oauth_callback(
    State(oauth): State<OAuthState>,
    Query(params): Query<CallbackParams>,
) -> Response {
    // FusionAuth passes state back as a JSON string (since construct_oauth2_authorize_url
    // serializes it with serde_json). Strip the surrounding quotes.
    let session_id = match &params.state {
        Some(s) => s.trim_matches('"').to_string(),
        None => {
            tracing::warn!("no state parameter in FusionAuth callback");
            return (
                axum::http::StatusCode::BAD_REQUEST,
                "missing state parameter",
            )
                .into_response();
        }
    };
    tracing::info!(%session_id, pending_count = oauth.pending.len(), "oauth callback received");

    // Look up the pending flow.
    let pending = match oauth.pending.remove(&session_id) {
        Some((_, p)) => p,
        None => {
            tracing::warn!(%session_id, "no pending flow found for session");
            return (
                axum::http::StatusCode::BAD_REQUEST,
                "unknown or expired session",
            )
                .into_response();
        }
    };

    // Exchange the FusionAuth authorization code for a JWT via FusionAuth's
    // POST /oauth2/token endpoint.
    let (access_token, _refresh_token) = match oauth
        .fusionauth_client
        .complete_authorization_code_grant(&params.code)
        .await
    {
        Ok(tokens) => tokens,
        Err(e) => {
            tracing::error!(error=?e, "FusionAuth authorization code grant failed");
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                "authorization code exchange failed",
            )
                .into_response();
        }
    };

    // Issue our own authorization code, storing the validated JWT.
    let our_code = uuid::Uuid::new_v4().to_string();
    oauth.codes.insert(
        our_code.clone(),
        super::state::IssuedCode {
            access_token,
            code_challenge: pending.code_challenge,
            redirect_uri: pending.client_redirect_uri.clone(),
            expires_at: Instant::now() + Duration::from_secs(300),
        },
    );

    // Redirect back to the client (Claude) with our code and the original state.
    let redirect_url = format!(
        "{}?code={}&state={}",
        pending.client_redirect_uri,
        urlencoding::encode(&our_code),
        urlencoding::encode(&pending.client_state),
    );

    Redirect::temporary(&redirect_url).into_response()
}

// ── 4. Token exchange ───────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct TokenParams {
    grant_type: String,
    code: String,
    #[serde(default)]
    code_verifier: Option<String>,
    #[serde(default)]
    redirect_uri: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    client_id: Option<String>,
}

#[derive(Serialize)]
struct TokenResponse {
    access_token: String,
    token_type: &'static str,
}

/// `POST /token` — client exchanges our authorization code for an access token.
pub async fn token(
    State(oauth): State<OAuthState>,
    axum::Form(params): axum::Form<TokenParams>,
) -> Response {
    if params.grant_type != "authorization_code" {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported grant_type",
        )
            .into_response();
    }

    let issued = match oauth.codes.remove(&params.code) {
        Some((_, c)) => c,
        None => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                "invalid or expired code",
            )
                .into_response();
        }
    };

    if issued.expires_at < Instant::now() {
        return (axum::http::StatusCode::BAD_REQUEST, "code expired").into_response();
    }

    // OAuth 2.1 §4.1.3: if redirect_uri was in the authorization request,
    // it must match exactly in the token request.
    match &params.redirect_uri {
        Some(uri) if *uri != issued.redirect_uri => {
            return (axum::http::StatusCode::BAD_REQUEST, "redirect_uri mismatch").into_response();
        }
        None => {
            return (axum::http::StatusCode::BAD_REQUEST, "redirect_uri required").into_response();
        }
        _ => {}
    }

    // Validate PKCE: BASE64URL(SHA256(code_verifier)) must equal code_challenge.
    match params.code_verifier {
        Some(verifier) => {
            let digest = Sha256::digest(verifier.as_bytes());
            let computed = URL_SAFE_NO_PAD.encode(digest);
            if computed != issued.code_challenge {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    "PKCE verification failed",
                )
                    .into_response();
            }
        }
        None => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                "code_verifier required",
            )
                .into_response();
        }
    }

    Json(TokenResponse {
        access_token: issued.access_token,
        token_type: "Bearer",
    })
    .into_response()
}
