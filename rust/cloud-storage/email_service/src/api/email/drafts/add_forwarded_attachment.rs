use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum AddForwardedAttachmentError {
    #[error("Draft not found")]
    DraftNotFound,

    #[error("Attachment not found")]
    AttachmentNotFound,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for AddForwardedAttachmentError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            AddForwardedAttachmentError::DraftNotFound
            | AddForwardedAttachmentError::AttachmentNotFound => StatusCode::NOT_FOUND,
            AddForwardedAttachmentError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().as_str(),
            }),
        )
            .into_response()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, IntoParams)]
pub struct PathParams {
    /// The ID of the draft to add the forwarded attachment to.
    pub id: Uuid,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct AddForwardedAttachmentRequest {
    /// The ID of the original attachment to forward.
    pub attachment_id: Uuid,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct AddForwardedAttachmentResponse {
    /// The ID of the original attachment.
    pub attachment_id: Uuid,
    /// Original file name of the attachment.
    pub filename: Option<String>,
    /// MIME type of the attachment.
    pub mime_type: Option<String>,
    /// File size in bytes.
    pub size_bytes: Option<i64>,
}

/// Add a forwarded attachment to a draft.
#[utoipa::path(
    post,
    tag = "Drafts",
    path = "/email/drafts/{id}/forwarded-attachments",
    operation_id = "add_forwarded_attachment",
    params(PathParams),
    request_body = AddForwardedAttachmentRequest,
    responses(
        (status = 201, body = AddForwardedAttachmentResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    Path(PathParams { id: draft_id }): Path<PathParams>,
    Json(req): Json<AddForwardedAttachmentRequest>,
) -> Result<(StatusCode, Json<AddForwardedAttachmentResponse>), AddForwardedAttachmentError> {
    // Ensure draft exists and belongs to this link
    if !email_db_client::messages::get::draft_exists_with_id(&ctx.db, link.id, draft_id).await? {
        return Err(AddForwardedAttachmentError::DraftNotFound);
    }

    // Verify the attachment exists in email_attachments and belongs to this link
    let result = email_db_client::attachments::provider::fetch_attachment_by_id(
        &ctx.db,
        req.attachment_id,
        link.id,
    )
    .await?;

    let Some((attachment, _message_provider_id)) = result else {
        return Err(AddForwardedAttachmentError::AttachmentNotFound);
    };

    // Insert the forwarded attachment link
    email_db_client::attachments::forwarded::insert_forwarded_attachment(
        &ctx.db,
        link.id,
        draft_id,
        req.attachment_id,
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(AddForwardedAttachmentResponse {
            attachment_id: attachment.db_id,
            filename: attachment.filename,
            mime_type: attachment.mime_type,
            size_bytes: attachment.size_bytes,
        }),
    ))
}
