use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::context::ApiContext;

use model::{response::ErrorResponse, tracking::IPContext, user::UserContext};

#[derive(serde::Deserialize, serde::Serialize, Debug, utoipa::ToSchema)]
pub struct CreateInProgressLinkResponse {
    /// The link id
    pub link_id: String,
}

/// Initiates a link for a user
#[utoipa::path(
        post,
        operation_id = "create_in_progress_link",
        path = "/link",
        responses(
            (status = 200, body=CreateInProgressLinkResponse),
            (status = 400, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    tracing::info!("create_in_progress_link");

    let count =
        macro_db_client::in_progress_user_link::count_existing_in_progress_user_links_for_user(
            &ctx.db,
            &user_context.fusion_user_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to count existing in progress user links for user");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get current link count",
                }),
            )
                .into_response()
        })?;

    if count >= 5 {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorResponse {
                message: "you have too many in progress links. resolve them or wait 24 hours before creating new ones",
            }),
        ).into_response());
    }

    let link_id = macro_db_client::in_progress_user_link::create_in_progress_user_link(
        &ctx.db,
        &user_context.fusion_user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to create in progress user link");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to create in progress user link",
            }),
        )
            .into_response()
    })?;

    Ok((
        StatusCode::OK,
        Json(CreateInProgressLinkResponse {
            link_id: link_id.to_string(),
        }),
    )
        .into_response())
}
