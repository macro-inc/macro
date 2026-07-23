use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use utoipa::ToSchema;

use crate::api::context::{ApiContext, AuthorizationService};

use macro_authorization::MacroAuthorizationExtractor;
use model::response::ErrorResponse;

#[derive(serde::Deserialize, serde::Serialize, Debug)]
pub struct Params {
    pub idp_name: Option<String>,
    pub idp_id: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, ToSchema)]
pub struct UserLinkResponse {
    /// Whether or not a link exists for the given idp
    pub link_exists: bool,
}

/// Returns whether or not a given idp link exists for a user
#[utoipa::path(
        get,
        path = "/user/link_exists",
        operation_id = "get_user_link_exists",
        params(
            ("idp_name" = String, Query, description = "The idp name to lookup. If not provided, the idp_id must be provided."),
            ("idp_id" = String, Query, description = "The idp id to lookup. If not provided, the idp_name must be provided."),
        ),
        responses(
            (status = 200, body=UserLinkResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, authorization), fields(user_id = authorization.user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService>,
    extract::Query(params): extract::Query<Params>,
) -> Result<Response, Response> {
    tracing::info!("get_user_link_exists");

    let idp_id = if let Some(idp_id) = params.idp_id {
        idp_id
    } else if let Some(idp_name) = params.idp_name {
        ctx.auth_client
            .get_identity_provider_id_by_name(&idp_name)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get identity provider id by name");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to get identity provider id by name".into(),
                    }),
                )
                    .into_response()
            })?
    } else {
        tracing::trace!("no idp_name or idp_id provided");
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "missing idp_name or idp_id".into(),
            }),
        )
            .into_response());
    };

    let links = ctx
            .auth_client
            .get_links(&authorization.user_context.fusion_user_id, Some(idp_id.clone()))
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "error fetching links for userid {} and idp id {}", authorization.user_context.fusion_user_id, idp_id.as_str());
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to fetch links".into(),
                    }),
                )
                    .into_response()
            })?;

    Ok((
        StatusCode::OK,
        Json(UserLinkResponse {
            link_exists: !links.is_empty(),
        }),
    )
        .into_response())
}
