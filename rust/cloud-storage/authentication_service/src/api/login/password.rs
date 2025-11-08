use crate::{
    api::{
        context::ApiContext,
        utils::{create_access_token_cookie, create_refresh_token_cookie},
    },
    service::fusionauth_client::error::FusionAuthClientError,
};
use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::{
    authentication::login::request::PasswordRequest,
    response::{ErrorResponse, UserTokensResponse},
    tracking::IPContext,
};
use tower_cookies::Cookies;

/// Performs a password login
#[utoipa::path(
        post,
        operation_id = "password_login",
        path = "/login/password",
        responses(
            (status = 200, body=UserTokensResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, req, ip_context), fields(email=%req.email, client_ip=%ip_context.client_ip))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    cookies: Cookies,
    extract::Json(req): extract::Json<PasswordRequest>,
) -> Result<Response, Response> {
    if !email_validator::is_valid_email(&req.email) {
        tracing::error!(email=%req.email, "invalid email");
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "invalid email",
            }),
        )
            .into_response());
    }

    // All emails in fusionauth are stored lowercase
    let lowercase_email = req.email.to_lowercase();

    let (access_token, refresh_token) = match ctx
        .auth_client
        .password_login(&lowercase_email, &req.password)
        .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::trace!(error=?e, "unable to login user");
            match e {
                FusionAuthClientError::UserNotVerified => {
                    return Err((
                        StatusCode::UNAUTHORIZED,
                        Json(ErrorResponse {
                            message: "user has not verified their primary email",
                        }),
                    )
                        .into_response());
                }
                FusionAuthClientError::UserNotRegistered => {
                    ctx.auth_client
                        .register_user_from_email(&lowercase_email)
                        .await
                        .map_err(|e| {
                            tracing::trace!(error=?e, "unable to register user");
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(ErrorResponse {
                                    message: "unable to register user",
                                }),
                            )
                                .into_response()
                        })?;

                    // User is now registered, re-login
                    ctx.auth_client
                        .password_login(&lowercase_email, &req.password)
                        .await
                        .map_err(|e| {
                            tracing::trace!(error=?e, "unable to login user");
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(ErrorResponse {
                                    message: "unable to login user",
                                }),
                            )
                                .into_response()
                        })?
                }
                _ => {
                    return Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            message: "unable to login user",
                        }),
                    )
                        .into_response());
                }
            }
        }
    };

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
