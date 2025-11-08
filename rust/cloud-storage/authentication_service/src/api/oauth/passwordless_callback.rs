use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};
use std::collections::HashMap;
use tower_cookies::Cookies;

use crate::{
    api::{
        context::ApiContext,
        utils::{create_access_token_cookie, create_refresh_token_cookie},
    },
    service::fusionauth_client::error::FusionAuthClientError,
};

use model::response::{ErrorResponse, UserTokensResponse};

#[derive(serde::Deserialize)]
pub struct Params {
    pub code: String,
}

/// Handles oauth redirect
#[utoipa::path(
        get,
        path = "/oauth/passwordless/{code}",
        operation_id = "passwordless_callback",
        params(
            ("code" = String, Path, description = "Code"),
            ("email" = String, Query, description = "Email")
        ),
        responses(
            (status = 200, body = UserTokensResponse),
            (status = 400, body=String),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, cookies))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    cookies: Cookies,
    Path(Params { code }): Path<Params>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, Response> {
    let disable_redirect = if let Some(disable_redirect) = params.get("disable_redirect") {
        disable_redirect == "true"
    } else {
        false
    };

    // TODO: once we deploy to prod, remove email being optional
    // validate email matches code
    if let Some(email) = params.get("email") {
        let email = urlencoding::decode(email).map_err(|e| {
            tracing::error!(error=?e, "unable to decode email");
            (StatusCode::BAD_REQUEST, "unable to decode email").into_response()
        })?;

        let passwordless_code = ctx
            .macro_cache_client
            .get_passwordless_login_code(&email)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, email=%email, "unable to get passwordless login code");
                (StatusCode::UNAUTHORIZED, "no passwordless login found").into_response()
            })?;

        if passwordless_code != code {
            return Err((StatusCode::UNAUTHORIZED, "invalid code").into_response());
        }
    }

    let passwordless_response = ctx
        .auth_client
        .complete_passwordless_login(&code)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "complete_passwordless_login: unable to complete passwordless login");
            match e {
                FusionAuthClientError::IncorrectCode => (
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        message: "invalid code",
                    }),
                )
                    .into_response(),
                _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            }
        })?;

    // Ensure that the user email matches what email we associated with the code
    // Only perform this check if the email param was not provided
    if !params.contains_key("email") {
        tracing::trace!("no email param provided, performing additional verification");
        let email = passwordless_response.user.email.to_lowercase();
        let passwordless_code = ctx.macro_cache_client.get_passwordless_login_code(&email).await.map_err(|e| {
            tracing::error!(error=?e, email=%passwordless_response.user.email, "unable to get passwordless login code");
            (StatusCode::INTERNAL_SERVER_ERROR, "unable to get passwordless login code").into_response()
        })?;

        if code != passwordless_code {
            tracing::error!("passwordless code does not match");
            return Err((StatusCode::UNAUTHORIZED, "invalid code").into_response());
        }
    }

    cookies.add(create_access_token_cookie(&passwordless_response.token));
    cookies.add(create_refresh_token_cookie(
        &passwordless_response.refresh_token,
    ));

    // remove the users passwordless login rate limits
    tokio::spawn({
        let macro_cache_client = ctx.macro_cache_client.clone();
        let email = passwordless_response.user.email.clone();
        async move {
            let _ = macro_cache_client
                .delete_passwordless_rate_limit(&email)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to delete passwordless rate limit");
                });

            let _ = macro_cache_client
                .delete_passwordless_daily_rate_limit(&email)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to delete passwordless daily rate limit");
                });

            let _ = macro_cache_client
                .delete_code_rate_limit(&email)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to delete login code rate limit");
                });

            let _ = macro_cache_client
                .delete_daily_code_rate_limit(&email)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to delete login code daily rate limit");
                });
        }
    });

    if disable_redirect {
        return Ok((
            StatusCode::OK,
            Json(UserTokensResponse {
                access_token: passwordless_response.token,
                refresh_token: passwordless_response.refresh_token,
            }),
        )
            .into_response());
    }

    Ok(Redirect::to(&passwordless_response.state.redirect_uri).into_response())
}
