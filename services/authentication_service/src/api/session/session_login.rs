use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};

use macro_cache_client::MacroCache;
use tower_cookies::Cookies;
use tracing::field::Empty;

use crate::{
    api::{
        context::ApiContext,
        utils::{create_access_token_cookie, create_refresh_token_cookie},
    },
    session_code_binding::{SESSION_CODE_VERIFIER_HEADER, SentVerifier},
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
            ("session_code" = String, Path, description = "The session code"),
            ("x-session-code-verifier" = Option<String>, Header, description = "The verifier whose S256 challenge the sign-in sent as `session_code_challenge`. A code minted with a challenge redeems only with it, and a request that sends one redeems only such a code."),
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
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Response, Response> {
    let code_verifier = SentVerifier::from_header(headers.get(SESSION_CODE_VERIFIER_HEADER));
    let (access_token, refresh_token) = redeem_session_code(
        &ctx.macro_cache_client,
        &session_code,
        &code_verifier,
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
/// success. A code stored with a challenge redeems only with the verifier
/// that answers it, and a request that sends a verifier redeems only such a
/// code: a client that binds its sign-ins never gets an unbound code of its
/// own. Any other request spends the code, since whoever sent it holds a code
/// that was never theirs. If the token refresh fails, the code is put back,
/// with its challenge, for the rest of its lifetime so the client's retry can
/// succeed.
///
/// The span never records the code, verifier or tokens, only the outcome. No
/// `err`: each failure already logs once with its `auth_handoff_failure`, and
/// an unknown code is the client's error, not ours.
#[tracing::instrument(
    name = "auth.session_code.redeem",
    skip_all,
    fields(
        outcome = Empty,
        code_bound = Empty,
        verifier = code_verifier.kind(),
        code_restored = Empty,
    )
)]
async fn redeem_session_code<E: std::fmt::Debug>(
    cache: &MacroCache,
    session_code: &str,
    code_verifier: &SentVerifier,
    refresh: impl AsyncFnOnce(&str) -> Result<(String, String), E>,
) -> Result<(String, String), RedeemError> {
    let span = tracing::Span::current();
    let session = cache
        .take_mobile_login_session(session_code)
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

    let Some(session) = session else {
        span.record("outcome", "invalid");
        tracing::warn!(
            auth_handoff_failure = "session_code_invalid",
            "mobile session code not found, expired or already redeemed"
        );
        return Err(RedeemError::Invalid);
    };

    span.record("code_bound", session.code_challenge().is_some());
    let refusal = match (session.code_challenge(), code_verifier) {
        (None, SentVerifier::Absent) => None,
        (Some(challenge), sent) if sent.answers(challenge) => None,
        (None, _) => Some(("code_unbound", "session_code_unbound")),
        (Some(_), SentVerifier::Absent) => {
            Some(("verifier_missing", "session_code_verifier_missing"))
        }
        (Some(_), _) => Some(("verifier_mismatch", "session_code_verifier_mismatch")),
    };
    if let Some((outcome, failure)) = refusal {
        span.record("outcome", outcome);
        tracing::warn!(
            auth_handoff_failure = failure,
            "session code does not answer the sign-in that redeemed it"
        );
        return Err(RedeemError::Invalid);
    }

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
