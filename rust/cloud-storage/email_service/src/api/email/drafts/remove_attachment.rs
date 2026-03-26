use crate::api::context::ApiContext;
use crate::generate_attachment_s3_key;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::{EmptyResponse, ErrorResponse};
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::IntoParams;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum RemoveDraftAttachmentError {
    #[error("Draft not found")]
    DraftNotFound,

    #[error("Attachment not found")]
    AttachmentNotFound,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for RemoveDraftAttachmentError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            RemoveDraftAttachmentError::DraftNotFound
            | RemoveDraftAttachmentError::AttachmentNotFound => StatusCode::NOT_FOUND,
            RemoveDraftAttachmentError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
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
    /// The ID of the draft to remove the attachment from.
    pub id: Uuid,
    /// The ID of the attachment to remove.
    pub attachment_id: Uuid,
}

/// Remove an attachment from a draft.
#[utoipa::path(
    delete,
    tag = "Drafts",
    path = "/email/drafts/{id}/attachments/{attachment_id}",
    operation_id = "remove_draft_attachment",
    params(PathParams),
    responses(
        (status = 201, body = EmptyResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
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
) -> Result<impl IntoResponse, RemoveDraftAttachmentError> {
    // ensure draft exists
    if !email_db_client::messages::get::draft_exists_with_id(&ctx.db, link.id, draft_id).await? {
        return Err(RemoveDraftAttachmentError::DraftNotFound);
    }

    let rows_affected = email_db_client::attachments::draft::delete_draft_attachment(
        &ctx.db,
        link.id,
        draft_id,
        attachment_id,
    )
    .await?;

    if rows_affected == 0 {
        return Err(RemoveDraftAttachmentError::AttachmentNotFound);
    }

    let s3_key = generate_attachment_s3_key!(draft_id, attachment_id);

    // will not error if attachment does not exist in S3
    ctx.s3_client
        .delete(&ctx.config.attachment_bucket, &s3_key)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
