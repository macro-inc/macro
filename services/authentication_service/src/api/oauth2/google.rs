use anyhow::Context;
use email_validator::normalize_email;
use std::borrow::Cow;

use axum::{
    Json,
    response::{IntoResponse, Response},
};
use calendar_events::domain::models::GoogleScopeSet;
use model::response::ErrorResponse;
use reqwest::StatusCode;
use tower_cookies::Cookies;
use uuid::Uuid;

use crate::{
    account_link_state::LinkProvider,
    api::{
        context::ApiContext,
        link::gmail::GMAIL_MAILBOX_SCOPE,
        oauth2::{
            OAuthState,
            account_link::{
                build_callback_redirect, build_return_redirect, cleanup_pending_link,
                replace_identity_provider_grant,
            },
            format_redirect_uri,
            login::{self},
            provider_query_value,
        },
    },
};
use fusionauth::error::FusionAuthClientError;
use fusionauth::google::oauth::GoogleExchangeTokenResponse;
use fusionauth::identity_provider::{IdentityProviderLink, LinkUserRequest};
use models_email::service::link::UserProvider;

#[cfg(test)]
mod test;

/// The `email_link_error` query value the app reads when Google's consent
/// left out the mailbox permissions.
const GMAIL_NOT_GRANTED_ERROR: &str = "gmail_not_granted";

/// How a Google account-link callback ended.
#[derive(Debug, PartialEq, Eq)]
enum GoogleLinkOutcome {
    /// The grant is attached to the account's FusionAuth identity and recorded
    /// on the pending link for `/email/init` to apply.
    Linked,
    /// The consent asked for the mailbox but Google's grant lacks it, so the
    /// account cannot become an inbox. Nothing was attached, and the grant was
    /// revoked at Google unless an inbox already works on it.
    MailboxNotGranted,
}

/// What to do with the grant behind a refused consent.
#[derive(Debug, PartialEq, Eq)]
enum PartialGrantDisposition {
    /// Revoke it at Google, so the next consent screen lists every scope again.
    Revoke,
    /// Leave it alone: an inbox already works on it.
    Keep,
}

/// Google's revocation endpoint revokes the account's whole grant to Macro,
/// not only the token it is handed. An inbox that still works on that
/// account's grant would lose its mail and calendar sync, so its grant is kept
/// and only the refusal stands. An inbox whose grant already stopped yielding
/// tokens has nothing to lose, and revoking lets the retry start from a clean
/// consent screen.
fn partial_grant_disposition(existing_inbox_needs_reauth: Option<bool>) -> PartialGrantDisposition {
    match existing_inbox_needs_reauth {
        Some(false) => PartialGrantDisposition::Keep,
        Some(true) | None => PartialGrantDisposition::Revoke,
    }
}

/// Whether a consent that asked for the mailbox came back without it.
///
/// Google's granular consent lets the user leave any box unchecked. A
/// calendar upgrade (`ConsentScopes::Calendar`) never asks for the mailbox, so
/// its grant is not judged here.
fn mailbox_grant_missing(requested: &[String], granted: &[String]) -> bool {
    requested.iter().any(|scope| scope == GMAIL_MAILBOX_SCOPE)
        && !granted.iter().any(|scope| scope == GMAIL_MAILBOX_SCOPE)
}

#[tracing::instrument(
    name = "email.link.google.complete",
    skip_all,
    fields(link_id = %link_id, outcome = tracing::field::Empty),
    err(Debug)
)]
async fn link_user(
    ctx: &ApiContext,
    identity_provider_id: &str,
    code: &str,
    link_id: &Uuid,
) -> Result<GoogleLinkOutcome, (StatusCode, String)> {
    let in_progress =
        macro_db_client::in_progress_user_link::get_in_progress_user_link(&ctx.db, link_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let macro_user_id = in_progress.macro_user_id;
    if in_progress.email_provider != "GMAIL" {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid Google linking attempt".into(),
        ));
    }

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

    // Google's actual grant may be a subset of what was requested. Without the
    // mailbox scope `/email/init` cannot provision the inbox, so the grant is
    // refused here, before it is attached to anyone's identity. Consent
    // requests carry `include_granted_scopes=true`, so a partial grant left
    // behind would ride into every later consent and Google would stop
    // listing its scopes, leaving the user no way to add the mailbox on a
    // retry; it is revoked unless an inbox already works on the account's
    // grant (see `partial_grant_disposition`).
    let requested_scopes = in_progress.requested_google_scopes;
    let granted_scopes = resolved_granted_scopes(&token_response.scope, requested_scopes.clone());
    if mailbox_grant_missing(&requested_scopes, &granted_scopes) {
        let calendar_granted =
            GoogleScopeSet::from_scopes(granted_scopes.iter().cloned()).has_calendar_capability();
        // A failed lookup keeps the grant: refusing is still right, and a
        // revocation that might hit a working inbox is not worth the risk.
        let disposition = match email_db_client::links::get::fetch_link_by_email(
            &ctx.db,
            &user_info_email,
            UserProvider::Gmail,
        )
        .await
        {
            Ok(existing_inbox) => {
                partial_grant_disposition(existing_inbox.map(|inbox| inbox.needs_reauth))
            }
            Err(error) => {
                tracing::warn!(error = ?error, "unable to look up the inbox of a refused Google grant; keeping the grant");
                PartialGrantDisposition::Keep
            }
        };
        tracing::info!(
            calendar_granted,
            revoke = disposition == PartialGrantDisposition::Revoke,
            "Google consent left out the mailbox scope; refusing the link"
        );
        if disposition == PartialGrantDisposition::Revoke {
            revoke_partial_grant(ctx, &token_response).await;
        }
        tracing::Span::current().record("outcome", GMAIL_NOT_GRANTED_ERROR);
        return Ok(GoogleLinkOutcome::MailboxNotGranted);
    }

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

    tracing::Span::current().record("outcome", "linked");
    Ok(GoogleLinkOutcome::Linked)
}

/// Best effort: a partial grant that stays behind only hides its scopes on the
/// next consent screen; the refusal itself does not depend on the revocation.
async fn revoke_partial_grant(ctx: &ApiContext, token_response: &GoogleExchangeTokenResponse) {
    let token = if token_response.refresh_token.is_empty() {
        &token_response.access_token
    } else {
        &token_response.refresh_token
    };
    if token.is_empty() {
        tracing::warn!("Google returned no token to revoke the partial grant with");
        return;
    }
    ctx.auth_client
        .revoke_google_grant(token)
        .await
        .inspect_err(|error| {
            tracing::warn!(error = ?error, "failed to revoke the partial Google grant");
        })
        .ok();
}

fn resolved_granted_scopes(returned: &str, requested: Vec<String>) -> Vec<String> {
    if returned.trim().is_empty() {
        requested
    } else {
        GoogleScopeSet::parse(returned).into_vec()
    }
}

/// Sends a refused consent back to the page that started it, which explains
/// the outcome and offers a retry. A link flow without a return URL gets the
/// explanation as the response body instead.
fn mailbox_not_granted_response(original_url: Option<&str>, link_id: &Uuid) -> Response {
    match original_url {
        Some(original_url) => build_return_redirect(
            original_url,
            &[
                ("link_id", &link_id.to_string()),
                ("email_link_error", GMAIL_NOT_GRANTED_ERROR),
                ("provider", provider_query_value(LinkProvider::Google)),
            ],
        )
        .unwrap_or_else(IntoResponse::into_response),
        None => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "Gmail access was not granted; allow the Gmail permissions and try again"
                    .into(),
            }),
        )
            .into_response(),
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

        let outcome = link_result.map_err(|(status_code, error)| {
            tracing::error!(error=?error, "unable to link user");
            (
                status_code,
                Json(ErrorResponse {
                    message: error.into(),
                }),
            )
                .into_response()
        })?;

        if outcome == GoogleLinkOutcome::MailboxNotGranted {
            cleanup_pending_link(ctx, link_id).await;
            return Ok(mailbox_not_granted_response(
                state.original_url.as_deref(),
                link_id,
            ));
        }

        if let Some(original_url) = &state.original_url {
            return build_callback_redirect(original_url, link_id)
                .map_err(IntoResponse::into_response);
        }

        return Ok(StatusCode::OK.into_response());
    }

    // The user does not need a link, complete the standard idp login
    login::handler(ctx, cookies, code, "google", state).await
}
