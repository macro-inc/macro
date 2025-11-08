use crate::api::{
    context::ApiContext,
    oauth2::{OAuthState, format_redirect_uri},
    utils::{
        create_access_token_cookie, create_refresh_token_cookie, default_redirect_url,
        generate_session_code,
    },
};
use axum::{
    Json,
    response::{IntoResponse, Redirect, Response},
};
use macro_env::Environment;
use model::response::ErrorResponse;
use reqwest::StatusCode;
use tower_cookies::Cookies;

/// Handles logging in through an identity provider
pub(in crate::api::oauth2) async fn handler(
    ctx: &ApiContext,
    cookies: Cookies,
    code: &str,
    provider: &str,
    state: &OAuthState,
) -> Result<Response, Response> {
    let environment = Environment::new_or_prod();

    // No link_id was provided, login the user through fusionauth
    let (access_token, refresh_token) = ctx
        .auth_client
        .complete_identity_provider_login(
            &state.identity_provider_id,
            code,
            &format_redirect_uri(provider),
            false, // no_link set to false means the user will be automatically created/linked by fusionauth depending on how we have the identity provider setup
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to complete identity provider login");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;

    // generate a session code if we are on mobile
    let session_code = if let Some(is_mobile) = state.is_mobile {
        if is_mobile {
            Some(generate_session_code())
        } else {
            None
        }
    } else {
        None
    };

    // Create base redirect url
    let mut url = if let Some(original_url) = &state.original_url {
        let url = urlencoding::decode(original_url).map_err(|e| {
            tracing::error!(error=?e, "unable to decode original url");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "unable to decode original url",
                }),
            )
                .into_response()
        })?;

        url.parse()
            .inspect_err(|e| tracing::error!(error=?e, "unable to parse string to url"))
            .map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        message: "unable to parse to original url",
                    }),
                )
                    .into_response()
            })?
    } else {
        default_redirect_url()
    };

    if let Some(session_code) = session_code {
        // Append the session code to the url
        url.query_pairs_mut()
            .append_pair("session_code", &session_code);

        ctx.macro_cache_client
            .set_mobile_login_session(&session_code, &refresh_token)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to set mobile login session");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to store session code",
                    }),
                )
                    .into_response()
            })?;

        tracing::trace!("session code provided, updating redirect url");
    }

    // Set cookies
    cookies.add(create_access_token_cookie(&access_token));
    cookies.add(create_refresh_token_cookie(&refresh_token));

    match environment {
        Environment::Local => Ok(StatusCode::OK.into_response()), // We don't really care about redirect in local
        Environment::Production | Environment::Develop => {
            Ok(Redirect::to(url.as_str()).into_response())
        }
    }
}
