//! Authenticated connection endpoints; ownership and consent policy live in the domain.
use crate::domain::{
    auth::{AuthError, ClaudeAuth},
    model::Secret,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

/// Router dependencies, assembled by the service composition root.
pub struct ClaudeAuthState<S, A> {
    service: Arc<S>,
    authorization: MacroAuthorizationState<A>,
}
impl<S, A> ClaudeAuthState<S, A> {
    /// Bind the domain service and standard Macro authentication.
    pub fn new(service: Arc<S>, authorization: MacroAuthorizationState<A>) -> Self {
        Self {
            service,
            authorization,
        }
    }
}
impl<S, A> Clone for ClaudeAuthState<S, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}
impl<S, A> FromRef<ClaudeAuthState<S, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &ClaudeAuthState<S, A>) -> Self {
        state.authorization.clone()
    }
}

/// A JSON body is required on writes, including start/disconnect (no form-based CSRF).
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EmptyRequest {}

/// One-time manual code. Deliberately does not implement Debug.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteRequest {
    /// Server-issued handle; never an owner selected by the caller.
    pub attempt_id: String,
    /// Claude's complete code#state string, not an access token.
    #[schema(value_type = String)]
    pub code: Secret,
}

/// Safe connection metadata.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    /// Whether this deployment supports browser connection.
    pub enabled: bool,
    /// Whether the authenticated Macro user has connected.
    pub connected: bool,
    /// Whether reconnecting after service restart is required.
    pub ephemeral: bool,
}

/// Public PKCE challenge and attempt handle; contains no verifier or provider tokens.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartResponse {
    /// Opaque owner-bound attempt handle.
    pub attempt_id: String,
    /// Claude-hosted consent page.
    pub authorization_url: String,
    /// Attempt lifetime in seconds.
    pub expires_in: u64,
}

/// Build `/claude-auth` routes. Bot and harness credentials are rejected by UserOnly.
pub fn router<S: ClaudeAuth, A: MacroAuthorizationService>(state: ClaudeAuthState<S, A>) -> Router {
    Router::new()
        .route(
            "/claude-auth",
            get(status::<S, A>).delete(disconnect::<S, A>),
        )
        .route("/claude-auth/start", post(start::<S, A>))
        .route("/claude-auth/complete", post(complete::<S, A>))
        .layer(DefaultBodyLimit::max(8192))
        .layer(axum::middleware::map_response(
            |mut response: Response| async move {
                response
                    .headers_mut()
                    .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                response
            },
        ))
        .with_state(state)
}

/// Read connection status for the authenticated user only.
#[utoipa::path(get, path = "/claude-auth", tag = "claude-auth", security(("bearerAuth" = [])), responses((status = 200, body = StatusResponse), (status = 401, description = "Unauthenticated")))]
pub async fn status<S: ClaudeAuth, A: MacroAuthorizationService>(
    State(state): State<ClaudeAuthState<S, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
) -> Json<StatusResponse> {
    let status = state
        .service
        .status(auth.authorization.macro_user_id.as_ref())
        .await;
    Json(StatusResponse {
        enabled: status.enabled,
        connected: status.connected,
        ephemeral: status.ephemeral,
    })
}

/// Create an expiring PKCE challenge for the authenticated user.
#[utoipa::path(post, path = "/claude-auth/start", tag = "claude-auth", security(("bearerAuth" = [])), request_body = EmptyRequest, responses((status = 200, body = StartResponse), (status = 403, description = "Disabled"), (status = 429, description = "Too many attempts")))]
pub async fn start<S: ClaudeAuth, A: MacroAuthorizationService>(
    State(state): State<ClaudeAuthState<S, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Json(_input): Json<EmptyRequest>,
) -> Response {
    match state
        .service
        .begin(auth.authorization.macro_user_id.as_ref())
        .await
    {
        Ok(login) => Json(StartResponse {
            attempt_id: login.attempt_id,
            authorization_url: login.authorization_url,
            expires_in: login.expires_in,
        })
        .into_response(),
        Err(error) => failure(error),
    }
}

/// Exchange one code; never return access or refresh tokens.
#[utoipa::path(post, path = "/claude-auth/complete", tag = "claude-auth", security(("bearerAuth" = [])), request_body = CompleteRequest, responses((status = 204, description = "Connected"), (status = 400, description = "Invalid code"), (status = 409, description = "Expired or replayed"), (status = 502, description = "Provider failed")))]
pub async fn complete<S: ClaudeAuth, A: MacroAuthorizationService>(
    State(state): State<ClaudeAuthState<S, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Json(input): Json<CompleteRequest>,
) -> Response {
    match state
        .service
        .complete(
            auth.authorization.macro_user_id.as_ref(),
            &input.attempt_id,
            input.code,
        )
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => failure(error),
    }
}

/// Forget only the authenticated user's grant and cancel pending consent.
#[utoipa::path(delete, path = "/claude-auth", tag = "claude-auth", security(("bearerAuth" = [])), request_body = EmptyRequest, responses((status = 204, description = "Disconnected"), (status = 403, description = "Disabled")))]
pub async fn disconnect<S: ClaudeAuth, A: MacroAuthorizationService>(
    State(state): State<ClaudeAuthState<S, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Json(_input): Json<EmptyRequest>,
) -> Response {
    match state
        .service
        .disconnect(auth.authorization.macro_user_id.as_ref())
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => failure(error),
    }
}

fn failure(error: AuthError) -> Response {
    let status = match error {
        AuthError::Disabled => StatusCode::FORBIDDEN,
        AuthError::InvalidAttempt => StatusCode::CONFLICT,
        AuthError::InvalidCode => StatusCode::BAD_REQUEST,
        AuthError::Busy => StatusCode::TOO_MANY_REQUESTS,
        AuthError::Provider(_) => StatusCode::BAD_GATEWAY,
    };
    (
        status,
        Json(serde_json::json!({"message": error.to_string()})),
    )
        .into_response()
}
