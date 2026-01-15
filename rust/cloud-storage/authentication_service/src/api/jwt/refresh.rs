use crate::api::{
    context::TokenContext,
    utils::{create_access_token_cookie, create_refresh_token_cookie},
};
use authentication_service::service::fusionauth_client::{
    FusionAuthClient, error::FusionAuthClientError,
};
use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_auth::{
    error::MacroAuthError,
    middleware::decode_jwt::{JwtValidationArgs, decode_macro_access_token_allow_expired},
};
use macro_db_client::advisory_lock::try_acquire_user_refresh_xact_lock;
use model::response::UserTokensResponse;
use sqlx::PgPool;
use std::sync::Arc;
use tower_cookies::Cookies;

#[derive(Debug, thiserror::Error)]
pub enum RefreshError {
    #[error("internal server error")]
    InternalServerError,
    #[error("refresh in progress")]
    RefreshInProgress,
    #[error("invalid refresh token")]
    InvalidRefreshToken,
    #[error("unauthorized")]
    Unauthorized,
}

impl IntoResponse for RefreshError {
    fn into_response(self) -> Response {
        let status_code = match self {
            RefreshError::InternalServerError => StatusCode::INTERNAL_SERVER_ERROR,
            RefreshError::InvalidRefreshToken => StatusCode::BAD_REQUEST,
            RefreshError::RefreshInProgress => StatusCode::TOO_MANY_REQUESTS,
            RefreshError::Unauthorized => StatusCode::UNAUTHORIZED,
        };

        (status_code, self.to_string()).into_response()
    }
}

/// Refreshes a JWT token
/// You can either have your access token and refresh token in the cookies or in the request
/// headers
/// Authorization: Bearer <access_token>
/// x-macro-refresh-token: <refresh_token>
/// This returns the cookies with the new access and refresh token
#[utoipa::path(
        post,
        operation_id = "refresh",
        path = "/jwt/refresh",
        responses(
            (status = 200, body = UserTokensResponse),
            (status = 400, body=String),
            (status = 401, body=String),
            (status = 429, body=String, description = "Refresh already in progress for this user"),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(auth_client, db, jwt, token_context, cookies))]
pub async fn handler(
    State(auth_client): State<Arc<FusionAuthClient>>,
    State(db): State<PgPool>,
    State(jwt): State<JwtValidationArgs>,
    token_context: Extension<TokenContext>,
    cookies: Cookies,
) -> Result<Json<UserTokensResponse>, RefreshError> {
    match macro_auth::middleware::decode_jwt::validate_macro_access_token(
        &token_context.access_token,
        &jwt,
    ) {
        Ok(_) => {
            // jwt is valid, return back original tokens
            tracing::trace!("jwt still valid");
            return Ok(Json(UserTokensResponse {
                access_token: token_context.access_token.clone(),
                refresh_token: token_context.refresh_token.clone(),
            }));
        }
        Err(e) => match e {
            // We only want to refresh the token if it's expired
            MacroAuthError::JwtExpired => {}
            _ => {
                tracing::error!(error=?e, "unable to decode jwt");
                return Err(RefreshError::Unauthorized);
            }
        },
    }

    // Decode the JWT (allowing expired) to get the user ID for the advisory lock
    let user_id = decode_macro_access_token_allow_expired(&token_context.access_token, &jwt)
        .map_err(|e| {
            // Keeping this log in here to see why we couldn't decode the jwt
            tracing::error!(error=?e, "unable to decode jwt for user id");
            RefreshError::Unauthorized
        })?;

    // Acquire advisory lock to prevent concurrent refresh requests for the same user
    let mut txn = db.begin().await.map_err(|e| {
        tracing::error!(error=?e, "unable to start transaction");
        RefreshError::InternalServerError
    })?;

    let lock_acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to acquire advisory lock");
            RefreshError::InternalServerError
        })?;

    if !lock_acquired {
        return Err(RefreshError::RefreshInProgress);
    }

    let (access_token, refresh_token) = auth_client
        .refresh_token(&token_context.access_token, &token_context.refresh_token)
        .await
        .map_err(|e| match e {
            FusionAuthClientError::InvalidRefreshToken => RefreshError::InvalidRefreshToken,
            _ => {
                tracing::error!(error=?e, "unable to refresh token");
                RefreshError::InternalServerError
            }
        })?;

    // Add in cookies to response
    cookies.add(create_access_token_cookie(&access_token));
    cookies.add(create_refresh_token_cookie(&refresh_token));

    Ok(Json(UserTokensResponse {
        access_token,
        refresh_token,
    }))
}
