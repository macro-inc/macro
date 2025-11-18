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
#[tracing::instrument(skip(ctx, user_context, link, gmail_token), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    gmail_token: Extension<String>,
    Path(label_id): Path<Uuid>,
) -> Result<Response, Response> {
    let label = email_db_client::labels::get::fetch_label_by_id(&ctx.db, label_id, link.id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to fetch label");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to fetch label",
                }),
            )
                .into_response()
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "Label not found in database.",
                }),
            )
                .into_response()
        })?;

    let gmail_result = ctx
        .gmail_client
        .delete_label(gmail_token.as_str(), &label.provider_label_id)
        .await;

    if let Err(e) = &gmail_result {
        match e {
            gmail_client::GmailError::NotFound(_) => {
                tracing::warn!(
                    label_id = %label_id,
                    provider_label_id = %label.provider_label_id,
                    "Label not found in Gmail, but continuing with database deletion"
                );
            }
            _ => {
                tracing::error!(
                    error = ?e,
                    label_id = %label_id,
                    provider_label_id = %label.provider_label_id,
                    "Gmail API call to delete label failed"
                );
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "delete label gmail api call failed",
                    }),
                )
                    .into_response());
            }
        }
    }

    let label_deleted =
        email_db_client::labels::delete::delete_label_by_id(&ctx.db, label_id, link.id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to delete label from database");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to delete label from database",
                    }),
                )
                    .into_response()
            })?;

    if !label_deleted {
        // This should be rare since we already checked for existence, but handle it just in case
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "Label not found in database during deletion.",
            }),
        )
            .into_response());
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}
