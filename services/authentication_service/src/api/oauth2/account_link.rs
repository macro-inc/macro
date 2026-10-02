use axum::{
    Json,
    response::{IntoResponse, Redirect, Response},
};
use fusionauth::FusionAuthClient;
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

/// Replaces the stored provider grant, mapping client failures at the HTTP boundary.
pub(super) async fn replace_identity_provider_grant(
    auth_client: &FusionAuthClient,
    identity_provider_id: &str,
    link_owner_id: &str,
    display_name: &str,
    fresh_refresh_token: &str,
) -> AccountLinkResult<()> {
    auth_client
        .replace_identity_provider_grant(
            identity_provider_id,
            link_owner_id,
            display_name,
            None,
            fresh_refresh_token,
        )
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
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
