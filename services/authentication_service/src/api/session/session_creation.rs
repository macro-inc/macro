use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use utoipa::ToSchema;

use crate::api::{
    context::{ApiContext, TokenContext},
    session::code_challenge::CodeChallenge,
    utils::generate_session_code,
};

use model::response::ErrorResponse;

/// What a page asks for when it hands its session to an app.
#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreationRequest {
    /// `BASE64URL(SHA-256(verifier))` (PKCE `S256`) of the verifier the
    /// redeeming app holds.
    pub challenge: String,
}

/// A session code for the caller's session, redeemable once, within five
/// minutes, with the verifier behind the request's challenge.
#[derive(serde::Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreationResponse {
    pub session_code: String,
}

/// Mints a session code for the caller's session, bound to the app that will
/// redeem it.
///
/// A browser that finished sign-up hands its session to the native app this
/// way: the code travels in a `macro://` link, which another app could
/// claim, so it redeems only with the verifier the app kept
/// (`POST /session/login`).
#[utoipa::path(
        post,
        operation_id = "session_creation",
        path = "/session",
        request_body = SessionCreationRequest,
        responses(
            (status = 200, body = SessionCreationResponse),
            (status = 400, body = ErrorResponse),
            (status = 500, body = ErrorResponse),
        )
    )]
#[tracing::instrument(name = "auth.session_code.mint", skip_all)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    token_context: Extension<TokenContext>,
    Json(request): Json<SessionCreationRequest>,
) -> Result<Response, Response> {
    let challenge = CodeChallenge::parse(&request.challenge).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: e.to_string().into(),
            }),
        )
            .into_response()
    })?;

    let session_code = generate_session_code();
    ctx.macro_cache_client
        .set_bound_mobile_login_session(
            &session_code,
            &token_context.refresh_token,
            challenge.as_str(),
        )
        .await
        .map_err(|e| {
            tracing::error!(
                auth_handoff_failure = "session_code_store_failed",
                error = ?e,
                "unable to store bound mobile login session"
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to store session code".into(),
                }),
            )
                .into_response()
        })?;

    Ok(Json(SessionCreationResponse { session_code }).into_response())
}
