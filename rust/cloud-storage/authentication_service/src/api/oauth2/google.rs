use anyhow::Context;
use email_validator::normalize_email;
use std::borrow::Cow;

use axum::{
    Json,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use reqwest::StatusCode;
use tower_cookies::Cookies;

use crate::{
    api::{
        context::ApiContext,
        oauth2::{
            OAuthState, format_redirect_uri,
            login::{self},
        },
    },
    service::{
        fusionauth_client::identity_provider::{IdentityProviderLink, LinkUserRequest},
        user::create_user::create_user_profile,
    },
};

async fn link_user(
    ctx: &ApiContext,
    identity_provider_id: &str,
    code: &str,
    link_id: &str,
) -> Result<(), (StatusCode, String)> {
    // Get existing macro user id from link id
    let macro_user_id =
        macro_db_client::in_progress_user_link::get_macro_user_id_by_link_id(&ctx.db, link_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let token_response = ctx
        .auth_client
        .exchange_google_code_for_tokens(code, &format_redirect_uri("google"))
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to exchange code for tokens {e}"),
            )
        })?;

    let user_info = ctx
        .auth_client
        .parse_google_id_token(&token_response.id_token)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to decode id token {e}"),
            )
        })?;

    let user_info_email = normalize_email(&user_info.email)
        .context("email should be normalizable")
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to normalize email {}", user_info.email),
            )
        })?;

    // Check if this is an account merge situation
    match macro_db_client::user::get::get_user_id_by_email(ctx.db.clone(), &user_info_email).await {
        Ok(_) => {
            // NOTE: the user profile already exists, we need to handle account merging separately
            return Err((
                StatusCode::NOT_IMPLEMENTED,
                "user profile already exists".to_string(),
            ));
        }
        Err(_e) => (), // if there is an error we assume that it's because the user does not exist
    }

    // Creates the new user profile
    create_user_profile(&macro_user_id.to_string(), &user_info.email, &ctx.db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to create user profile {e}"),
            )
        })?;

    // With the token response and the user's macro_user_id, we can now link the user
    match ctx
        .auth_client
        .link_user(LinkUserRequest {
            identity_provider_link: IdentityProviderLink {
                display_name: user_info_email.clone(),
                identity_provider_id: Cow::Borrowed(identity_provider_id),
                identity_provider_user_id: Cow::Borrowed(&user_info.sub), // google user id
                user_id: Cow::Borrowed(&macro_user_id.to_string()),       // fusionauth user id
                token: Cow::Borrowed(&token_response.refresh_token), // For google, this is the refresh token
            },
        })
        .await
    {
        Ok(()) => (),
        Err(e) => {
            let macro_user_id = format!("macro|{}", &user_info_email);

            let _ = macro_db_client::user::delete_user::delete_user(&ctx.db, &macro_user_id)
                .await
                .inspect_err(|e| {
                    tracing::error!(
                        error=?e,
                        "unable to delete user {user_info_email}"
                    );
                });

            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to link user {e}"),
            ));
        }
    }

    // delete in_progress_user_link once complete
    let _ = macro_db_client::in_progress_user_link::delete_in_progress_user_link(&ctx.db, link_id)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to delete in progress user link");
        });

    Ok(())
}

pub(in crate::api::oauth2) async fn handler(
    ctx: &ApiContext,
    cookies: Cookies,
    code: &str,
    state: &OAuthState,
) -> Result<Response, Response> {
    // if the link id is provided, this user is already logged in to an account. therefore, we
    // don't need to handle completing the login through fusionauth
    if let Some(link_id) = state.link_id.as_ref() {
        link_user(ctx, &state.identity_provider_id, code, link_id)
            .await
            .map_err(|(status_code, error)| {
                tracing::error!(error=?error, "unable to link user");
                (status_code, Json(ErrorResponse { message: &error })).into_response()
            })?;
        // Early exit, we don't actually log the user into fusionauth
        return Ok(StatusCode::OK.into_response());
    }

    // The user does not need a link, complete the standard idp login
    login::handler(ctx, cookies, code, "google", state).await
}
