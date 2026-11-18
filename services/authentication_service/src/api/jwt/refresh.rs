#[cfg(test)]
mod test;

use crate::api::{
    context::TokenContext,
    utils::{create_access_token_cookie, create_refresh_token_cookie},
};
use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use fusionauth::{FusionAuthClient, error::FusionAuthClientError};
use macro_auth::{
    error::MacroAuthError,
    middleware::decode_jwt::{
        JwtValidationArgs, validate_fusionauth_access_token_allow_expired,
        validate_macro_access_token,
    },
};
use model::response::UserTokensResponse;
use std::{sync::Arc, time::Duration};
use tower_cookies::Cookies;

/// Minimum age of a token without the Macro claims before it is refreshed. A newer one most
/// likely came from a refresh whose populate lambda just failed, and while the lambda keeps
/// failing, every client retry (websocket reconnects refresh on each attempt) would otherwise be
/// another FusionAuth refresh and lambda run.
const MISSING_MACRO_CLAIMS_REFRESH_COOLDOWN: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum RefreshError {
    #[error("internal server error")]
    InternalServerError,
    #[error("refresh in progress")]
    #[allow(dead_code)]
    RefreshInProgress,
    #[error("access token without macro claims was issued too recently to refresh")]
    MissingMacroClaimsCooldown,
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
            RefreshError::RefreshInProgress | RefreshError::MissingMacroClaimsCooldown => {
                StatusCode::TOO_MANY_REQUESTS
            }
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
            (status = 429, body=String, description = "Refresh already in progress for this user, or the access token lacks the Macro claims and was issued too recently to refresh"),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(auth_client, jwt, token_context, cookies))]
pub async fn handler(
    State(auth_client): State<Arc<FusionAuthClient>>,
    State(jwt): State<JwtValidationArgs>,
    token_context: Extension<TokenContext>,
    cookies: Cookies,
) -> Result<Json<UserTokensResponse>, RefreshError> {
    match validate_macro_access_token(&token_context.access_token, &jwt) {
        Ok(_) => {
            // jwt is valid, return back original tokens
            tracing::trace!("jwt still valid");
            return Ok(Json(UserTokensResponse {
                access_token: token_context.access_token.clone(),
                refresh_token: token_context.refresh_token.clone(),
            }));
        }
        Err(MacroAuthError::JwtExpired) => {}
        // FusionAuth issues the token without the Macro claims when the JWT populate lambda
        // fails; refreshing runs the lambda again.
        Err(e) => {
            match validate_fusionauth_access_token_allow_expired(&token_context.access_token, &jwt)
            {
                Ok(issued_at)
                    if issued_at.elapsed().unwrap_or_default()
                        < MISSING_MACRO_CLAIMS_REFRESH_COOLDOWN =>
                {
                    tracing::info!(error=?e, "access token without macro claims is too new to refresh");
                    return Err(RefreshError::MissingMacroClaimsCooldown);
                }
                Ok(_) => {
                    tracing::info!(error=?e, "refreshing access token without macro claims");
                }
                Err(_) => {
                    tracing::error!(error=?e, "unable to decode jwt");
                    return Err(RefreshError::Unauthorized);
                }
            }
        }
    }

    // NOTE: Disabled until we fix FE auth setup.
    // // Decode the JWT (allowing expired) to get the user ID for the advisory lock
    // let user_id = decode_macro_access_token_allow_expired(&token_context.access_token, &jwt)
    //     .map_err(|e| {
    //         // Keeping this log in here to see why we couldn't decode the jwt
    //         tracing::error!(error=?e, "unable to decode jwt for user id");
    //         RefreshError::Unauthorized
    //     })?;
    //
    // // Acquire advisory lock to prevent concurrent refresh requests for the same user
    // let mut txn = db.begin().await.map_err(|e| {
    //     tracing::error!(error=?e, "unable to start transaction");
    //     RefreshError::InternalServerError
    // })?;
    //
    // let lock_acquired = try_acquire_user_refresh_xact_lock(&mut txn, &user_id)
    //     .await
    //     .map_err(|e| {
    //         tracing::error!(error=?e, "unable to acquire advisory lock");
    //         RefreshError::InternalServerError
    //     })?;
    //
    // if !lock_acquired {
    //     return Err(RefreshError::RefreshInProgress);
    // }

    let start_time = std::time::Instant::now();
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

    tracing::info!(time_taken=?start_time.elapsed(), "refresh token time");

    validate_macro_access_token(&access_token, &jwt)
        .inspect_err(|e| {
            tracing::warn!(error=?e, "fusionauth issued an access token that fails validation");
        })
        .ok();

    // Add in cookies to response
    cookies.add(create_access_token_cookie(&access_token));
    cookies.add(create_refresh_token_cookie(&refresh_token));

    Ok(Json(UserTokensResponse {
        access_token,
        refresh_token,
    }))
}
