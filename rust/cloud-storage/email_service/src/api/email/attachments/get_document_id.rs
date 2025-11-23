use crate::api::context::ApiContext;
use crate::util::upload_attachment::upload_attachment;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use models_email::api;
use models_email::api::attachment::AttachmentDocumentID;
use models_email::email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum GetAttachmentDocumentIdError {
    #[error("Attachment not found")]
    AttachmentNotFound,

    #[error("Database error occurred")]
    DatabaseError(anyhow::Error),

    #[error("Failed to upload attachment")]
    UploadError(anyhow::Error),
}

impl IntoResponse for GetAttachmentDocumentIdError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetAttachmentDocumentIdError::AttachmentNotFound => StatusCode::NOT_FOUND,
            GetAttachmentDocumentIdError::DatabaseError(_)
            | GetAttachmentDocumentIdError::UploadError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (status_code, self.to_string()).into_response()
    }
}

/// The response returned from the get attachment endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetAttachmentDocumentIDResponse {
    pub data: api::attachment::AttachmentDocumentID,
}

/// Get the Macro document id for an email attachment, uploading it if it doesn't already exist.
#[utoipa::path(
    get,
    tag = "Attachments",
    path = "/email/attachments/{id}/document_id",
    operation_id = "get_attachment_document_id",
    params(
        ("id" = Uuid, Path, description = "Attachment ID."),
    ),
    responses(
            (status = 200, body = GetAttachmentDocumentIDResponse),
            (status = 400, body = ErrorResponse),
            (status = 401, body = ErrorResponse),
            (status = 404, body = ErrorResponse),
            (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    gmail_token: Extension<String>,
    Path(attachment_id): Path<Uuid>,
) -> Result<Json<GetAttachmentDocumentIDResponse>, GetAttachmentDocumentIdError> {
    // return ID if attachment already exists in Macro
    let existing_document_id =
        email_db_client::attachments::provider::get_document_id_by_attachment_id(
            &ctx.db,
            link.id,
            attachment_id,
        )
        .await
        .map_err(GetAttachmentDocumentIdError::DatabaseError)?;

    if let Some(document_id) = existing_document_id {
        return Ok(Json(GetAttachmentDocumentIDResponse {
            data: AttachmentDocumentID {
                attachment_id,
                document_id,
            },
        }));
    }

    // upload attachment if it doesn't already exist
    let attachment_metadata =
        email_db_client::attachments::provider::upload::fetch_attachment_upload_metadata_by_id(
            &ctx.db,
            attachment_id,
            link.id,
        )
        .await
        .map_err(GetAttachmentDocumentIdError::DatabaseError)?
        .ok_or(GetAttachmentDocumentIdError::AttachmentNotFound)?;

    let document_id = upload_attachment(
        &ctx.redis_client,
        &ctx.gmail_client,
        &ctx.dss_client,
        &gmail_token,
        &link,
        &attachment_metadata,
    )
    .await
    .map_err(GetAttachmentDocumentIdError::UploadError)?;

    Ok(Json(GetAttachmentDocumentIDResponse {
        data: AttachmentDocumentID {
            attachment_id,
            document_id,
        },
    }))
}
