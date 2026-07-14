use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::IntoParams;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum RemoveForwardedAttachmentError {
    #[error("Draft not found")]
    DraftNotFound,

    #[error("Attachment not found")]
    AttachmentNotFound,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for RemoveForwardedAttachmentError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            RemoveForwardedAttachmentError::DraftNotFound
            | RemoveForwardedAttachmentError::AttachmentNotFound => StatusCode::NOT_FOUND,
            RemoveForwardedAttachmentError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, IntoParams)]
pub struct PathParams {
    /// The ID of the draft to remove the forwarded attachment from.
    pub id: Uuid,
    /// The ID of the forwarded attachment to remove.
    pub attachment_id: Uuid,
}

/// Remove a forwarded attachment from a draft.
#[utoipa::path(
    delete,
    tag = "Drafts",
    path = "/email/drafts/{id}/forwarded-attachments/{attachment_id}",
    operation_id = "remove_forwarded_attachment",
    params(PathParams),
    responses(
        (status = 204),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    Path(PathParams {
        id: draft_id,
        attachment_id,
    }): Path<PathParams>,
) -> Result<impl IntoResponse, RemoveForwardedAttachmentError> {
    // Ensure draft exists
    if !email_db_client::messages::get::draft_exists_with_id(&ctx.db, link.id, draft_id).await? {
        return Err(RemoveForwardedAttachmentError::DraftNotFound);
    }

    let rows_affected = email_db_client::attachments::forwarded::delete_forwarded_attachment(
        &ctx.db,
        link.id,
        draft_id,
        attachment_id,
    )
    .await?;

    if rows_affected == 0 {
        return Err(RemoveForwardedAttachmentError::AttachmentNotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}
