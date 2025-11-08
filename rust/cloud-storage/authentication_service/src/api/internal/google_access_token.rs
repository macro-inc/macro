use crate::service::fusionauth_client::FusionAuthClient;
use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::auth::internal_access::ValidInternalKey;
use model::authentication::google_token::GoogleAccessToken;
use model::response::ErrorResponse;
use std::sync::Arc;

#[derive(serde::Deserialize, Debug)]
pub struct GoogleAccessTokenParams {
    fusionauth_user_id: String,
    macro_id: String,
}

/// Gets link between user and identity provider
#[tracing::instrument(skip(auth_client, _internal_access))]
pub async fn handler(
    State(auth_client): State<Arc<FusionAuthClient>>,
    _internal_access: ValidInternalKey,
    extract::Query(params): extract::Query<GoogleAccessTokenParams>,
) -> Result<Response, Response> {
    get_access_token(auth_client, &params, "google_gmail").await
}

/// Fetches access token for a user from specified identity provider
#[tracing::instrument(skip(auth_client))]
async fn get_access_token(
    auth_client: Arc<FusionAuthClient>,
    params: &GoogleAccessTokenParams,
    identity_provider_name: &str,
) -> Result<Response, Response> {
    let fusionauth_user_id = params.fusionauth_user_id.as_str();
    let email = params.macro_id.replace("macro|", "");

    // get identity provider id
    let idp_id = auth_client
        .get_identity_provider_id_by_name(identity_provider_name)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to find idp id for {}", identity_provider_name);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to find idp",
                }),
            )
                .into_response()
        })?;

    // get refresh token via link
    let links = auth_client
        .get_links(fusionauth_user_id, Some(idp_id.clone()))
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "error fetching links for userid {} and idp id {}", fusionauth_user_id, idp_id.as_str());
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to fetch links",
                }),
            )
                .into_response()
        })?;

    // a fusionauth user can have multiple links to the same identity provider with different email
    // addresses, but can only have one link with a given email
    let link = links
        .into_iter()
        .find(|l| l.display_name == email)
        .ok_or_else(|| {
            tracing::error!(
                "link not found for user id {} and idp id {}",
                fusionauth_user_id,
                idp_id.as_str()
            );
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: format!("No {} link found for this user", identity_provider_name)
                        .as_str(),
                }),
            )
                .into_response()
        })?;

    // get access token using refresh token
    let token_response = auth_client
        .refresh_google_token(link.token.as_str())
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "error fetching access token for userid {}", fusionauth_user_id);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: format!("unable to fetch {} access token", identity_provider_name)
                        .as_str(),
                }),
            )
                .into_response()
        })?;

    Ok((
        StatusCode::OK,
        Json(GoogleAccessToken {
            access_token: token_response.access_token,
        }),
    )
        .into_response())
}
