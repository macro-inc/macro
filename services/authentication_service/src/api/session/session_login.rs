use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use macro_cache_client::{MacroCache, auth::MobileLoginRedemption};
use tower_cookies::Cookies;
use tracing::field::Empty;
use utoipa::ToSchema;

use crate::api::{
    context::ApiContext,
    session::code_challenge::{CodeChallenge, CodeVerifier},
    utils::{create_access_token_cookie, create_refresh_token_cookie},
};

use model::response::{ErrorResponse, UserTokensResponse};

#[cfg(test)]
mod test;

#[derive(serde::Deserialize)]
pub struct Params {
    pub session_code: String,
}

/// Performs a login via session code
#[utoipa::path(
        get,
        operation_id = "session_login",
        path = "/session/login/{session_code}",
        params(
            ("session_code" = String, Path, description = "The session code")
        ),
        responses(
            (status = 200, body=UserTokensResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[axum::debug_handler]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(Params { session_code }): Path<Params>,
    cookies: Cookies,
) -> Result<Response, Response> {
    sign_in_with_session_code(&ctx, &session_code, None, cookies).await
}

/// A session code and the verifier of the challenge it was minted with.
#[derive(serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedSessionLoginRequest {
    pub session_code: String,
    /// The PKCE verifier whose `S256` challenge the code was minted with.
    pub verifier: String,
}

/// Performs a login via a session code bound to a challenge
/// (`POST /session`), presenting the challenge's verifier.
#[utoipa::path(
        post,
        operation_id = "session_login_verified",
        path = "/session/login",
        request_body = VerifiedSessionLoginRequest,
        responses(
            (status = 200, body=UserTokensResponse),
            (status = 400, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[axum::debug_handler]
pub async fn verified_handler(
    State(ctx): State<ApiContext>,
    cookies: Cookies,
    request: Result<Json<VerifiedSessionLoginRequest>, JsonRejection>,
) -> Result<Response, Response> {
    let Json(request) = request.map_err(bad_request)?;
    let verifier = CodeVerifier::parse(request.verifier).map_err(bad_request)?;
    let challenge = CodeChallenge::of(&verifier);
    sign_in_with_session_code(&ctx, &request.session_code, Some(&challenge), cookies).await
}

/// A request this route cannot read (no JSON, a missing field, a malformed
/// verifier) answers 400 with an `ErrorResponse`, as documented, before any
/// code is looked up.
fn bad_request(error: impl std::fmt::Display) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            message: error.to_string().into(),
        }),
    )
        .into_response()
}

async fn sign_in_with_session_code(
    ctx: &ApiContext,
    session_code: &str,
    challenge: Option<&CodeChallenge>,
    cookies: Cookies,
) -> Result<Response, Response> {
    let (access_token, refresh_token) = redeem_session_code(
        &ctx.macro_cache_client,
        session_code,
        challenge,
        async |refresh_token| ctx.auth_client.refresh_token("", refresh_token).await,
    )
    .await
    .map_err(IntoResponse::into_response)?;

    // Set the new cookies
    cookies.add(create_access_token_cookie(&access_token));
    cookies.add(create_refresh_token_cookie(&refresh_token));

    Ok((
        StatusCode::OK,
        Json(UserTokensResponse {
            access_token,
            refresh_token,
        }),
    )
        .into_response())
}

/// Why a session code did not sign anyone in.
#[derive(Debug, thiserror::Error)]
enum RedeemError {
    #[error("unable to look up session code")]
    Lookup,
    #[error("session code is unknown, expired or already redeemed")]
    Invalid,
    #[error("unable to refresh the session's token")]
    Refresh,
}

impl IntoResponse for RedeemError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            RedeemError::Lookup => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get session code",
            ),
            RedeemError::Invalid => (StatusCode::BAD_REQUEST, "invalid session code"),
            RedeemError::Refresh => (StatusCode::INTERNAL_SERVER_ERROR, "unable to refresh token"),
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Exchanges a session code for fresh tokens. The code redeems once: it is
/// taken atomically, so concurrent requests for one code yield exactly one
/// success. If the token refresh then fails, the code is put back for the
/// rest of its lifetime so the client's retry can succeed.
///
/// A code minted bound to a challenge redeems only when `challenge` matches
/// it; a caller without it leaves the code for the one that has it.
///
/// The span never records the code, tokens or challenge, only the outcome. No `err`:
/// each failure already logs once with its `auth_handoff_failure`, and an
/// unknown code is the client's error, not ours.
#[tracing::instrument(
    name = "auth.session_code.redeem",
    skip_all,
    fields(outcome = Empty, bound = Empty, code_restored = Empty)
)]
async fn redeem_session_code<E: std::fmt::Debug>(
    cache: &MacroCache,
    session_code: &str,
    challenge: Option<&CodeChallenge>,
    refresh: impl AsyncFnOnce(&str) -> Result<(String, String), E>,
) -> Result<(String, String), RedeemError> {
    let span = tracing::Span::current();
    let redemption = cache
        .take_mobile_login_session(session_code, challenge.map(CodeChallenge::as_str))
        .await
        .map_err(|e| {
            span.record("outcome", "lookup_failed");
            tracing::error!(
                auth_handoff_failure = "session_code_lookup_failed",
                error = ?e,
                "failed to get mobile login session"
            );
            RedeemError::Lookup
        })?;

    let session = match redemption {
        MobileLoginRedemption::Taken(session) => session,
        MobileLoginRedemption::Missing => {
            span.record("outcome", "invalid");
            tracing::warn!(
                auth_handoff_failure = "session_code_invalid",
                "mobile session code not found, expired or already redeemed"
            );
            return Err(RedeemError::Invalid);
        }
        // Answered like an unknown code: the caller learns nothing about
        // a code it cannot redeem.
        MobileLoginRedemption::ChallengeMismatch => {
            span.record("outcome", "challenge_mismatch");
            tracing::warn!(
                auth_handoff_failure = "session_code_challenge_mismatch",
                "bound session code presented without its verifier"
            );
            return Err(RedeemError::Invalid);
        }
    };
    span.record("bound", session.is_bound());

    match refresh(session.refresh_token()).await {
        Ok(tokens) => {
            span.record("outcome", "redeemed");
            Ok(tokens)
        }
        Err(e) => {
            span.record("outcome", "refresh_failed");
            tracing::error!(
                auth_handoff_failure = "session_refresh_failed",
                error = ?e,
                "unable to refresh token"
            );
            let restored = cache
                .restore_mobile_login_session(session_code, &session)
                .await
                .inspect_err(|e| {
                    tracing::error!(error = ?e, "unable to restore mobile login session");
                })
                .unwrap_or(false);
            span.record("code_restored", restored);
            Err(RedeemError::Refresh)
        }
    }
}
