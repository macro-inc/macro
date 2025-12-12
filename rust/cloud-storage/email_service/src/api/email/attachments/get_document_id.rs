use crate::api::context::ApiContext;
use crate::util::upload_attachment::{UploadAttachmentContext, upload_attachment};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use models_email::db::address::EmailRecipientType;
use models_email::email::service::link::Link;
use models_email::service::attachment::{AttachmentUploadArgs, AttachmentUploadDestination};
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
    pub attachment_id: Uuid,
    pub document_id: String,
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
            attachment_id,
            document_id,
        }));
    }

    // upload attachment if it doesn't already exist
    let attachment_metadata =
        email_db_client::attachments::provider::upload::fetch_attachment_upload_metadata_by_id(
            &ctx.db,
            link.id,
            attachment_id,
        )
        .await
        .map_err(GetAttachmentDocumentIdError::DatabaseError)?
        .ok_or(GetAttachmentDocumentIdError::AttachmentNotFound)?;

    let recipients = email_db_client::contacts::get::fetch_db_recipients(
        &ctx.db,
        attachment_metadata.message_db_id,
    )
    .await
    .map_err(GetAttachmentDocumentIdError::DatabaseError)?;

    let recipient_emails: Vec<String> = recipients
        .iter()
        .filter(|(_, recipient_type)| *recipient_type == EmailRecipientType::To)
        .filter_map(|(contact, _)| contact.email_address.clone())
        .collect();

    let attachment_upload_args = AttachmentUploadArgs {
        attachment_metadata,
        recipient_emails,
        backfill: false,
        // Frontend will soon use SFS URLs for image/video attachments directly instead of DSS
        // Until this transition is complete, we continue uploading all attachments to DSS
        upload_destination: AttachmentUploadDestination::Dss,
    };

    let ctx_upload = UploadAttachmentContext {
        db: &ctx.db,
        redis_client: &ctx.redis_client,
        gmail_client: &ctx.gmail_client,
        dss_client: &ctx.dss_client,
        sfs_client: &ctx.sfs_client,
        system_properties_service: &ctx.system_properties_service,
        access_token: &gmail_token,
        link: &link,
    };

    let document_id = upload_attachment(ctx_upload, &attachment_upload_args)
        .await
        .map_err(GetAttachmentDocumentIdError::UploadError)?;

    Ok(Json(GetAttachmentDocumentIDResponse {
        attachment_id,
        document_id,
    }))
}
