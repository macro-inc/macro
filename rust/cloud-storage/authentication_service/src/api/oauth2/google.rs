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
            // The link already exists but its stored refresh token may be dead (this
            // is the reconnect path). A plain `link_user` no-ops and leaves the dead
            // token in place, so swap in the freshly minted token. With no fresh token
            // (Google withheld a refresh token) there is nothing to swap, so leave the
            // existing grant untouched.
            if token_response.refresh_token.is_empty() {
                tracing::info!(
                    fusion_user_id = %idp_link_owner,
                    "idp link already exists and no fresh refresh token returned, leaving existing grant"
                );
            } else {
                relink_with_fresh_token(
                    ctx,
                    identity_provider_id,
                    &idp_link_owner,
                    &user_info_email,
                    &token_response.refresh_token,
                )
                .await?;
            }
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

/// Replaces a stale Google grant on an existing IdP link with a freshly minted
/// refresh token. Used on reconnect, when the mailbox's FusionAuth link already
/// exists but its stored token has gone dead — a plain `link_user` no-ops and
/// leaves the dead token in place.
///
/// A Google identity binds to exactly one FusionAuth user, so the grant is swapped
/// by unlinking the old link and re-linking with the new token, rolling back to the
/// old token if the re-link fails. A shared mailbox's grant lives on a deactivated
/// stub user; links are only created against active users, so the stub is
/// reactivated for the swap and returned to its prior state afterward (a human's own
/// active account is left active). Idempotent when the stored token already matches.
async fn relink_with_fresh_token(
    ctx: &ApiContext,
    identity_provider_id: &str,
    idp_link_owner: &str,
    email: &str,
    fresh_refresh_token: &str,
) -> Result<(), (StatusCode, String)> {
    let server_error = |message: String| (StatusCode::INTERNAL_SERVER_ERROR, message);
    let auth = &ctx.auth_client;

    let existing_links = auth
        .get_links(idp_link_owner, Some(identity_provider_id.to_string()))
        .await
        .map_err(|e| server_error(format!("unable to read existing links {e}")))?;

    let Some(existing) = existing_links.into_iter().find(|l| l.display_name == email) else {
        // Owner resolution and the already-exists error disagree about where the
        // link lives; there is nothing to relink on this user.
        tracing::warn!(
            fusion_user_id = %idp_link_owner,
            "relink: no existing grant found for mailbox on resolved owner, skipping"
        );
        return Ok(());
    };

    if existing.token == fresh_refresh_token {
        // Stored token already current; nothing to do.
        return Ok(());
    }

    let sub = existing.identity_provider_user_id;
    let stale_token = existing.token;

    let was_active = auth
        .get_user_active(idp_link_owner)
        .await
        .map_err(|e| server_error(format!("unable to read user active state {e}")))?;

    if !was_active {
        auth.reactivate_user(idp_link_owner)
            .await
            .map_err(|e| server_error(format!("unable to reactivate user for relink {e}")))?;
    }

    let link_with = |token: &str| LinkUserRequest {
        identity_provider_link: IdentityProviderLink {
            display_name: Cow::Owned(email.to_string()),
            identity_provider_id: Cow::Borrowed(identity_provider_id),
            identity_provider_user_id: Cow::Borrowed(&sub),
            user_id: Cow::Borrowed(idp_link_owner),
            token: Cow::Owned(token.to_string()),
        },
    };

    // Swap the grant, capturing the outcome so the stub is re-deactivated below on
    // every path — including an unlink failure — rather than leaking an active stub.
    let swap_result: Result<(), (StatusCode, String)> = async {
        auth.unlink_user(idp_link_owner, identity_provider_id, &sub)
            .await
            .map_err(|e| server_error(format!("unable to unlink stale grant {e}")))?;

        let link_result = auth.link_user(link_with(fresh_refresh_token)).await;

        if let Err(e) = &link_result {
            tracing::error!(error=?e, "relink: failed to attach fresh grant, rolling back to stale token");
            if let Err(rollback) = auth.link_user(link_with(&stale_token)).await {
                tracing::error!(error=?rollback, "relink: rollback re-link also failed, grant is detached");
            }
        }

        link_result.map_err(|e| server_error(format!("unable to attach fresh grant {e}")))
    }
    .await;

    // Restore the stub's deactivated state on every path; a human's own account was
    // active and is left as-is. Best-effort (logged) so a deactivation blip can't fail
    // a reconnect whose grant swap already succeeded.
    if !was_active && let Err(e) = auth.deactivate_user(idp_link_owner).await {
        tracing::error!(error=?e, %idp_link_owner, "relink: failed to re-deactivate stub after relink");
    }

    swap_result?;

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

            // Strip any stale identifiers embedded in the original_url
            // before appending fresh ones; consumers read the first
            // occurrence of each param.
            let filtered: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(k, _)| k != "link_id" && k != "token")
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
            url.query_pairs_mut().clear().extend_pairs(filtered);

            // `token` mirrors link_id for callback consumers that only
            // surface a `token` query param from the redirect URL.
            url.query_pairs_mut()
                .append_pair("link_id", &link_id.to_string())
                .append_pair("token", &link_id.to_string());

            return Ok(Redirect::to(url.as_str()).into_response());
        }

        return Ok(StatusCode::OK.into_response());
    }

    // The user does not need a link, complete the standard idp login
    login::handler(ctx, cookies, code, "google", state).await
}
