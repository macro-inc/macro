use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use tower_cookies::Cookies;

use crate::api::{
    context::ApiContext,
    utils::{create_access_token_cookie, create_refresh_token_cookie},
};

use model::response::{ErrorResponse, UserTokensResponse};

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
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(Params { session_code }): Path<Params>,
    cookies: Cookies,
) -> Result<Response, Response> {
    let refresh_token = ctx
        .macro_cache_client
        .get_mobile_login_session(&session_code)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get mobile login session");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get session code",
                }),
            )
                .into_response()
        })?;

    if refresh_token.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "invalid session code",
            }),
        )
            .into_response());
    }
    let refresh_token = refresh_token.unwrap();

    let (access_token, refresh_token) = ctx
        .auth_client
        .refresh_token("", &refresh_token)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, refresh_token=?refresh_token, "unable to refresh token");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to refresh token",
                }),
            )
                .into_response()
        })?;

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
