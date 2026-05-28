use anyhow::Context;
use email_validator::normalize_email;
use std::borrow::Cow;

use axum::{
    Json,
    response::{IntoResponse, Redirect, Response},
};
use model::response::ErrorResponse;
use reqwest::StatusCode;
use tower_cookies::Cookies;
use url::Url;

use crate::api::{
    context::ApiContext,
    oauth2::{
        OAuthState, format_redirect_uri,
        login::{self},
    },
};
use fusionauth::error::FusionAuthClientError;
use fusionauth::identity_provider::{IdentityProviderLink, LinkUserRequest};

async fn link_user(
    ctx: &ApiContext,
    identity_provider_id: &str,
    code: &str,
    link_id: &uuid::Uuid,
) -> Result<(), (StatusCode, String)> {
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

    // Attempt to create the FA IdP link for the calling user. Three terminal cases:
    //   Ok                                  → fresh link created; data-source path downstream.
    //   Err(alreadyLinked, owned by self)  → idempotent relink; data-source path no-ops downstream.
    //   Err(alreadyLinked, owned by other) → cross-account add; init promotes to graph edge.
    // The FA error doesn't distinguish self vs other in the typed variant, but it doesn't need
    // to — init re-derives ownership via macrodb's User table to pick its dispatch path.
    match ctx
        .auth_client
        .link_user(LinkUserRequest {
            identity_provider_link: IdentityProviderLink {
                display_name: user_info_email.clone(),
                identity_provider_id: Cow::Borrowed(identity_provider_id),
                identity_provider_user_id: Cow::Borrowed(&user_info.sub),
                user_id: Cow::Borrowed(&macro_user_id.to_string()),
                token: Cow::Borrowed(&token_response.refresh_token),
            },
        })
        .await
    {
        Ok(()) => {}
        Err(FusionAuthClientError::IdentityProviderLinkAlreadyExists) => {
            tracing::info!(
                fusion_user_id = %macro_user_id,
                linked_email = %user_info_email,
                "idp link already exists, skipping creation"
            );
        }
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to link user {e}"),
            ));
        }
    }

    // Stash the linked email on the in_progress_user_link row so /email/init can pick it up.
    // The row is consumed and deleted by /email/init once the email_links record is created.
    macro_db_client::in_progress_user_link::set_linked_email(&ctx.db, link_id, &user_info_email)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to record linked email on in_progress_user_link {e}"),
            )
        })?;

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
        let link_result = link_user(ctx, &state.identity_provider_id, code, link_id).await;

        if link_result.is_err() {
            // The OAuth callback failed; the in_progress_user_link row will never be
            // consumed by /email/init (no redirect carrying link_id is emitted on
            // error). Best-effort delete so a failed attempt doesn't burn one of
            // the user's 5 in-flight link slots.
            macro_db_client::in_progress_user_link::delete_in_progress_user_link(&ctx.db, link_id)
                .await
                .inspect_err(|e| {
                    tracing::warn!(
                        error=?e,
                        ?link_id,
                        "failed to clean up in_progress_user_link after link_user error"
                    );
                })
                .ok();
        }

        link_result.map_err(|(status_code, error)| {
            tracing::error!(error=?error, "unable to link user");
            (
                status_code,
                Json(ErrorResponse {
                    message: error.into(),
                }),
            )
                .into_response()
        })?;

        if let Some(original_url) = &state.original_url {
            let decoded = urlencoding::decode(original_url).map_err(|e| {
                tracing::error!(error=?e, "unable to decode original url");
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        message: "unable to decode original url".into(),
                    }),
                )
                    .into_response()
            })?;

            let mut url: Url = decoded
                .parse()
                .inspect_err(|e| tracing::error!(error=?e, "unable to parse string to url"))
                .map_err(|_| {
                    (
                        StatusCode::BAD_REQUEST,
                        Json(ErrorResponse {
                            message: "unable to parse to original url".into(),
                        }),
                    )
                        .into_response()
                })?;

            url.query_pairs_mut()
                .append_pair("link_id", &link_id.to_string());

            return Ok(Redirect::to(url.as_str()).into_response());
        }

        return Ok(StatusCode::OK.into_response());
    }

    // The user does not need a link, complete the standard idp login
    login::handler(ctx, cookies, code, "google", state).await
}
