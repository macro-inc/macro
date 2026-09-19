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

use crate::api::{
    context::ApiContext,
    oauth2::{
        OAuthState,
        account_link::{
            build_callback_redirect, cleanup_pending_link, replace_identity_provider_grant,
        },
        format_redirect_uri,
        login::{self},
    },
};
use fusionauth::error::FusionAuthClientError;
use fusionauth::identity_provider::{IdentityProviderLink, LinkUserRequest};

#[cfg(test)]
mod test;

async fn link_user(
    ctx: &ApiContext,
    identity_provider_id: &str,
    code: &str,
    link_id: &uuid::Uuid,
) -> Result<(), (StatusCode, String)> {
    let in_progress =
        macro_db_client::in_progress_user_link::get_in_progress_user_link(&ctx.db, link_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let macro_user_id = in_progress.macro_user_id;

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

    // The IdP link doubles as the linked email's LOGIN identity: a Google identity binds to
    // exactly one FusionAuth user, and sign-in resolves through that link. When the linked
    // email belongs to an existing macro user, the link must therefore live on THAT user's FA
    // account — attaching it to the requester would capture the owner's sign-in. Only
    // mailboxes with no macro user of their own link under the requester.
    let idp_link_owner =
        match macro_db_client::user::get::get_macro_user_id_by_email(&ctx.db, &user_info_email)
            .await
        {
            Ok(Some(mailbox_owner_fa)) => mailbox_owner_fa.to_string(),
            Ok(None) => macro_user_id.to_string(),
            Err(e) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("unable to look up mailbox owner for linked email {e}"),
                ));
            }
        };

    // Attempt to create the FA IdP link. Three terminal cases:
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
                user_id: Cow::Borrowed(&idp_link_owner),
                token: Cow::Borrowed(&token_response.refresh_token),
            },
        })
        .await
    {
        Ok(()) => {}
        Err(FusionAuthClientError::IdentityProviderLinkAlreadyExists) => {
            // A plain `link_user` leaves the existing grant untouched. Reconnects
            // replace a stale token when Google returns a fresh one.
            replace_identity_provider_grant(
                &ctx.auth_client,
                identity_provider_id,
                &idp_link_owner,
                &user_info_email,
                &token_response.refresh_token,
            )
            .await?;
        }
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to link user {e}"),
            ));
        }
    }

    // Stash the linked identity and Google's actual grant (which may be a
    // subset of what was requested). /email/init applies these capabilities
    // atomically to the durable link and schedules any newly unlocked work.
    let granted_scopes =
        resolved_granted_scopes(&token_response.scope, in_progress.requested_google_scopes);
    macro_db_client::in_progress_user_link::set_linked_google_grant(
        &ctx.db,
        link_id,
        &user_info_email,
        &granted_scopes,
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("unable to record linked Google grant on in_progress_user_link {e}"),
        )
    })?;

    Ok(())
}

fn resolved_granted_scopes(returned: &str, requested: Vec<String>) -> Vec<String> {
    if returned.trim().is_empty() {
        requested
    } else {
        calendar_events::domain::models::GoogleScopeSet::parse(returned).into_vec()
    }
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
            cleanup_pending_link(ctx, link_id).await;
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
            return build_callback_redirect(original_url, link_id)
                .map_err(IntoResponse::into_response);
        }

        return Ok(StatusCode::OK.into_response());
    }

    // The user does not need a link, complete the standard idp login
    login::handler(ctx, cookies, code, "google", state).await
}
