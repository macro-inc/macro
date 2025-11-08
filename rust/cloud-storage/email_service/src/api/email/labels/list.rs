use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::service;
use models_email::service::link::Link;
use utoipa::ToSchema;

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ListLabelsResponse {
    pub labels: Vec<service::label::Label>,
}

/// List user labels.
#[utoipa::path(
    get,
    tag = "Labels",
    path = "/email/labels",
    operation_id = "list_labels",
    responses(
            (status = 200, body=ListLabelsResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, link), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
) -> Result<Response, Response> {
    let labels = email_db_client::labels::get::fetch_labels_by_link_id(&ctx.db, link.id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to fetch labels");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to fetch labels",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(ListLabelsResponse { labels })).into_response())
}
