use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email_service::util::gmail::auth::fetch_gmail_access_token_from_link;
use email_service::util::upload_attachment::{
    UploadAttachmentContext, UploadAttachmentError, upload_attachment,
};
use model::response::ErrorResponse;
use models_email::db::address::EmailRecipientType;
use models_email::email::service::link::Link;
use models_email::service::attachment::{AttachmentUploadArgs, AttachmentUploadDestination};
use std::time::Duration;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum GetAttachmentDocumentIdError {
    #[error("Attachment not found")]
    AttachmentNotFound,

    #[error("Access denied")]
    AccessDenied,

    #[error("Database error occurred")]
    DatabaseError(anyhow::Error),

    #[error("Failed to upload attachment")]
    UploadError(UploadAttachmentError),
}

impl IntoResponse for GetAttachmentDocumentIdError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetAttachmentDocumentIdError::AttachmentNotFound => StatusCode::NOT_FOUND,
            GetAttachmentDocumentIdError::AccessDenied => StatusCode::FORBIDDEN,
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
#[tracing::instrument(skip(ctx), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    gmail_token: Extension<String>,
    Path(attachment_id): Path<Uuid>,
) -> Result<Json<GetAttachmentDocumentIDResponse>, GetAttachmentDocumentIdError> {
    // Fast path: return ID if attachment already exists in Macro
    if let Some(document_id) =
        email_db_client::attachments::provider::get_document_id_by_att_id(&ctx.db, attachment_id)
            .await
            .map_err(GetAttachmentDocumentIdError::DatabaseError)?
    {
        return Ok(Json(GetAttachmentDocumentIDResponse {
            attachment_id,
            document_id,
        }));
    }

    // Acquire a distributed lock to prevent duplicate uploads of the same attachment
    let lock_key = format!("attachment_upload:{}", attachment_id);
    let _lock = ctx
        .redis_client
        .acquire_lock(&lock_key, Duration::from_secs(60), Duration::from_secs(30))
        .await
        .map_err(|e| GetAttachmentDocumentIdError::DatabaseError(e.into()))?;

    // Re-check after acquiring lock — another request may have completed the upload
    if let Some(document_id) =
        email_db_client::attachments::provider::get_document_id_by_att_id(&ctx.db, attachment_id)
            .await
            .map_err(GetAttachmentDocumentIdError::DatabaseError)?
    {
        return Ok(Json(GetAttachmentDocumentIDResponse {
            attachment_id,
            document_id,
        }));
    }

    // Verify access and get owner's link and token
    let (owner_link, access_token) =
        verify_access_and_get_owner(&ctx, &link, gmail_token.0, attachment_id).await?;

    // Prepare and execute upload to owner's macro account
    let upload_args = prepare_upload_args(&ctx, attachment_id).await?;
    let document_id =
        upload_and_get_document_id(&ctx, &owner_link, &access_token, &upload_args).await?;

    // _lock released on drop

    Ok(Json(GetAttachmentDocumentIDResponse {
        attachment_id,
        document_id,
    }))
}

/// Verifies access and returns the owner's link and Gmail access token.
/// If the user is the owner, returns their link and token. Otherwise, verifies shared access
/// and returns the owner's link and token.
async fn verify_access_and_get_owner(
    ctx: &ApiContext,
    link: &Link,
    user_token: String,
    attachment_id: Uuid,
) -> Result<(Link, String), GetAttachmentDocumentIdError> {
    let (thread_id, owner_link_id) =
        email_db_client::attachments::provider::get_thread_id_for_attachment(
            &ctx.db,
            attachment_id,
        )
        .await
        .map_err(GetAttachmentDocumentIdError::DatabaseError)?
        .ok_or(GetAttachmentDocumentIdError::AttachmentNotFound)?;

    // User is the owner, use their link and token directly
    if owner_link_id == link.id {
        return Ok((link.clone(), user_token));
    }

    // Verify shared access to the thread
    macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2(
        &ctx.db,
        link.macro_id.as_ref(),
        thread_id.to_string().as_ref(),
        "thread",
    )
    .await
    .map_err(|(_, msg)| GetAttachmentDocumentIdError::DatabaseError(anyhow::anyhow!(msg)))?
    .ok_or(GetAttachmentDocumentIdError::AccessDenied)?;

    // Fetch owner's link and access token
    let owner_link = email_db_client::links::get::fetch_link_by_id(&ctx.db, owner_link_id)
        .await
        .map_err(GetAttachmentDocumentIdError::DatabaseError)?
        .ok_or(GetAttachmentDocumentIdError::AttachmentNotFound)?;

    let owner_token = fetch_gmail_access_token_from_link(
        &owner_link,
        &ctx.redis_client,
        &ctx.auth_service_client,
    )
    .await
    .map_err(GetAttachmentDocumentIdError::DatabaseError)?;

    Ok((owner_link, owner_token))
}

/// Prepares the upload arguments for an attachment.
async fn prepare_upload_args(
    ctx: &ApiContext,
    attachment_id: Uuid,
) -> Result<AttachmentUploadArgs, GetAttachmentDocumentIdError> {
    let attachment_metadata =
        email_db_client::attachments::provider::upload::fetch_attachment_upload_metadata_by_id(
            &ctx.db,
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

    Ok(AttachmentUploadArgs {
        attachment_metadata,
        recipient_emails,
        backfill: false,
        // Frontend will soon use SFS URLs for image/video attachments directly instead of DSS
        // Until this transition is complete, we continue uploading all attachments to DSS
        upload_destination: AttachmentUploadDestination::Dss,
    })
}

/// Uploads the attachment and returns the document ID.
async fn upload_and_get_document_id(
    ctx: &ApiContext,
    link: &Link,
    access_token: &str,
    upload_args: &AttachmentUploadArgs,
) -> Result<String, GetAttachmentDocumentIdError> {
    let ctx_upload = UploadAttachmentContext {
        db: &ctx.db,
        redis_client: &ctx.redis_client,
        gmail_client: &ctx.gmail_client,
        dss_client: &ctx.dss_client,
        sfs_client: &ctx.sfs_client,
        system_properties_service: &ctx.system_properties_service,
        access_token,
        link,
    };

    upload_attachment(ctx_upload, upload_args)
        .await
        .map_err(GetAttachmentDocumentIdError::UploadError)
}
