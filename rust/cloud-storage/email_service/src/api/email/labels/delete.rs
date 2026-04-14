use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::service::link::Link;
use uuid::Uuid;

/// Delete a label.
#[utoipa::path(
    delete,
    tag = "Labels",
    path = "/email/labels/{id}",
    operation_id = "delete_label",
    params(
        ("id" = Uuid, Path, description = "Label ID."),
    ),
    responses(
            (status = 204, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, link), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    Path(label_id): Path<Uuid>,
) -> Result<Response, Response> {
    let label = email_db_client::labels::get::fetch_label_by_id(&ctx.db, label_id, link.id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to fetch label");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to fetch label".into(),
                }),
            )
                .into_response()
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "Label not found in database.".into(),
                }),
            )
                .into_response()
        })?;

    // Optimistic: delete from DB first, then enqueue Gmail deletion
    let label_deleted =
        email_db_client::labels::delete::delete_label_by_id(&ctx.db, label_id, link.id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to delete label from database");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to delete label from database".into(),
                    }),
                )
                    .into_response()
            })?;

    if !label_deleted {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "Label not found in database during deletion.".into(),
            }),
        )
            .into_response());
    }

    // Enqueue Gmail label deletion to be processed by the gmail_ops worker
    ctx.sqs_client
        .enqueue_gmail_ops_notification(models_email::gmail::gmail_ops::GmailOpsPubsubMessage {
            link_id: link.id,
            operation: models_email::gmail::gmail_ops::GmailOpsOperation::DeleteLabel(
                models_email::gmail::gmail_ops::DeleteLabelPayload {
                    provider_label_id: label.provider_label_id.clone(),
                },
            ),
        })
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "Failed to enqueue gmail delete label operation");
        })
        .ok();

    Ok(StatusCode::NO_CONTENT.into_response())
}
