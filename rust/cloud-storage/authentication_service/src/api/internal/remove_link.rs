use crate::api::context::ApiContext;
use crate::service::fusionauth_client::error::FusionAuthClientError;

use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::auth::internal_access::ValidInternalKey;
use model::response::{EmptyResponse, ErrorResponse};

#[derive(serde::Deserialize, Debug)]
pub struct RemoveLinkQueryParams {
    pub fusionauth_user_id: String,
    pub macro_id: String,
    pub idp_name: String,
}

/// Removes a link for a user by the idp name
#[utoipa::path(
        delete,
        path = "/internal/remove_link/{fusionauth_user_id}/idp_name/{idp_name}",
        operation_id = "internal_remove_link",
        responses(
            (status = 200, body = EmptyResponse),
            (status = 404, body = ErrorResponse),
            (status = 500, body = ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, _valid_access))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _valid_access: ValidInternalKey,
    extract::Query(RemoveLinkQueryParams {
        fusionauth_user_id,
        macro_id,
        idp_name,
    }): extract::Query<RemoveLinkQueryParams>,
) -> Result<Response, Response> {
    tracing::info!("internal_remove_link");
    let idp_id = ctx
        .auth_client
        .get_identity_provider_id_by_name(&idp_name)
        .await
        .map_err(|e| match e {
            FusionAuthClientError::NoIdentityProviderFound => {
                tracing::warn!("no identity provider found for name {}", idp_name);
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        message: "no identity provider found",
                    }),
                )
                    .into_response()
            }
            _ => {
                tracing::error!(error=?e, "unable to get identity provider id by name");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to get identity provider id by name",
                    }),
                )
                    .into_response()
            }
        })?;

    tracing::trace!("removing link for idp id {}", idp_id);

    let links = ctx
        .auth_client
        .get_links(&fusionauth_user_id, Some(idp_id.clone()))
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

    let email = macro_id.replace("macro|", "");

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
                    message: format!("No {} link found for this user", idp_name).as_str(),
                }),
            )
                .into_response()
        })?;

    ctx.auth_client
        .unlink_user(
            &fusionauth_user_id,
            &idp_id,
            &link.identity_provider_user_id,
        )
        .await
        .map_err(|e| match e {
            FusionAuthClientError::NoIdentityProviderFound => {
                tracing::warn!(
                    "no identity provider found for user id {}",
                    fusionauth_user_id
                );
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        message: "no identity provider found",
                    }),
                )
                    .into_response()
            }
            _ => {
                tracing::error!(error=?e, "unable to unlink user");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to unlink user",
                    }),
                )
                    .into_response()
            }
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
