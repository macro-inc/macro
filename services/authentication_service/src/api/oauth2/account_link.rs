use std::borrow::Cow;

use axum::{
    Json,
    response::{IntoResponse, Redirect, Response},
};
use fusionauth::{
    FusionAuthClient,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
};
use model::response::ErrorResponse;
use reqwest::StatusCode;
use url::Url;
use uuid::Uuid;

use crate::api::context::ApiContext;

#[cfg(test)]
mod test;

type AccountLinkResult<T> = Result<T, (StatusCode, String)>;

#[derive(Debug)]
pub(super) enum CallbackRedirectError {
    UnableToDecode,
    UnableToParse,
}

impl IntoResponse for CallbackRedirectError {
    fn into_response(self) -> Response {
        let message = match self {
            Self::UnableToDecode => "unable to decode original url",
            Self::UnableToParse => "unable to parse to original url",
        };

        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Replaces the refresh token on an existing identity-provider link.
///
/// FusionAuth does not update a link when `link_user` reports that it already
/// exists, so reconnects must unlink and recreate it. The stale link is restored
/// if the replacement fails. Deactivated stub users are activated only for the
/// swap and then returned to their previous state.
#[tracing::instrument(skip(auth_client, display_name, fresh_refresh_token), err(Debug))]
pub(super) async fn replace_identity_provider_grant(
    auth_client: &FusionAuthClient,
    identity_provider_id: &str,
    link_owner_id: &str,
    display_name: &str,
    fresh_refresh_token: &str,
) -> AccountLinkResult<()> {
    let server_error = |message: String| (StatusCode::INTERNAL_SERVER_ERROR, message);

    if fresh_refresh_token.is_empty() {
        tracing::info!(
            fusion_user_id = %link_owner_id,
            "identity-provider link already exists and no fresh refresh token was returned; leaving existing grant"
        );
        return Ok(());
    }

    let existing_links = auth_client
        .get_links(link_owner_id, Some(identity_provider_id.to_string()))
        .await
        .map_err(|error| server_error(format!("unable to read existing links {error}")))?;

    let Some(existing_link) = existing_links
        .into_iter()
        .find(|link| link.display_name == display_name)
    else {
        tracing::warn!(
            fusion_user_id = %link_owner_id,
            "grant replacement found no matching link on the resolved owner; skipping"
        );
        return Ok(());
    };

    if existing_link.token == fresh_refresh_token {
        return Ok(());
    }

    let identity_provider_user_id = existing_link.identity_provider_user_id;
    let stale_refresh_token = existing_link.token;
    let was_active = auth_client
        .get_user_active(link_owner_id)
        .await
        .map_err(|error| server_error(format!("unable to read user active state {error}")))?;

    if !was_active {
        auth_client
            .reactivate_user(link_owner_id)
            .await
            .map_err(|error| {
                server_error(format!("unable to reactivate user for relink {error}"))
            })?;
    }

    let link_with_token = |refresh_token: &str| LinkUserRequest {
        identity_provider_link: IdentityProviderLink {
            display_name: Cow::Owned(display_name.to_string()),
            identity_provider_id: Cow::Borrowed(identity_provider_id),
            identity_provider_user_id: Cow::Borrowed(&identity_provider_user_id),
            user_id: Cow::Borrowed(link_owner_id),
            token: Cow::Owned(refresh_token.to_string()),
        },
    };

    let swap_result: AccountLinkResult<()> = async {
        auth_client
            .unlink_user(
                link_owner_id,
                identity_provider_id,
                &identity_provider_user_id,
            )
            .await
            .map_err(|error| server_error(format!("unable to unlink stale grant {error}")))?;

        let link_result = auth_client
            .link_user(link_with_token(fresh_refresh_token))
            .await;

        if let Err(error) = &link_result {
            tracing::error!(error=?error, "failed to attach fresh grant; rolling back to stale token");
            if let Err(rollback_error) = auth_client
                .link_user(link_with_token(&stale_refresh_token))
                .await
            {
                tracing::error!(error=?rollback_error, "grant rollback also failed; identity-provider link is detached");
            }
        }

        link_result.map_err(|error| {
            server_error(format!("unable to attach fresh grant {error}"))
        })
    }
    .await;

    if !was_active && let Err(error) = auth_client.deactivate_user(link_owner_id).await {
        tracing::error!(
            error=?error,
            %link_owner_id,
            "failed to re-deactivate stub after grant replacement"
        );
    }

    swap_result
}

/// Builds the redirect back to an account-link caller with fresh link identifiers.
pub(super) fn build_callback_redirect(
    original_url: &str,
    link_id: &Uuid,
) -> Result<Response, CallbackRedirectError> {
    let decoded_url = urlencoding::decode(original_url).map_err(|error| {
        tracing::error!(error=?error, "unable to decode original url");
        CallbackRedirectError::UnableToDecode
    })?;

    let mut url: Url = decoded_url
        .parse()
        .inspect_err(|error| tracing::error!(error=?error, "unable to parse string to url"))
        .map_err(|_| CallbackRedirectError::UnableToParse)?;

    let preserved_query_pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != "link_id" && key != "token")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.query_pairs_mut()
        .clear()
        .extend_pairs(preserved_query_pairs);

    let link_id = link_id.to_string();
    url.query_pairs_mut()
        .append_pair("link_id", &link_id)
        .append_pair("token", &link_id);

    Ok(Redirect::to(url.as_str()).into_response())
}

/// Removes a pending account-link row after a callback failure.
pub(super) async fn cleanup_pending_link(ctx: &ApiContext, link_id: &Uuid) {
    macro_db_client::in_progress_user_link::delete_in_progress_user_link(&ctx.db, link_id)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                error=?error,
                ?link_id,
                "failed to clean up in_progress_user_link after account-link callback error"
            );
        })
        .ok();
}
