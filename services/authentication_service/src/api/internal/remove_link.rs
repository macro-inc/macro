use crate::api::context::{ApiContext, AuthorizationService};
use crate::outbound::google_identity_links::{RemoveIdentityLinkError, remove_identity_link};
use fusionauth::FusionAuthClient;

use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use model::response::{EmptyResponse, ErrorResponse};

#[cfg(test)]
mod test;

#[derive(serde::Deserialize, Debug)]
pub struct RemoveLinkQueryParams {
    pub fusionauth_user_id: String,
    pub linked_email: String,
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
#[tracing::instrument(skip(ctx, _internal_authorization))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Query(RemoveLinkQueryParams {
        fusionauth_user_id,
        linked_email,
        idp_name,
    }): extract::Query<RemoveLinkQueryParams>,
) -> Result<Response, Response> {
    tracing::info!("internal_remove_link");
    remove_link(
        &ctx.auth_client,
        &fusionauth_user_id,
        &linked_email,
        &idp_name,
    )
    .await
}

async fn remove_link(
    auth_client: &FusionAuthClient,
    fusionauth_user_id: &str,
    linked_email: &str,
    idp_name: &str,
) -> Result<Response, Response> {
    remove_identity_link(auth_client, fusionauth_user_id, linked_email, idp_name)
        .await
        .map_err(|error| {
            let status = match error {
                RemoveIdentityLinkError::NoIdentityProvider => StatusCode::NOT_FOUND,
                RemoveIdentityLinkError::LookupProvider(_)
                | RemoveIdentityLinkError::FetchLinks(_)
                | RemoveIdentityLinkError::Unlink(_) => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (
                status,
                Json(ErrorResponse {
                    message: error.to_string().into(),
                }),
            )
                .into_response()
        })?;
    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
