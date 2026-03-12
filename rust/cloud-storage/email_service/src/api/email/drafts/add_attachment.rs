use crate::api::context::ApiContext;
use crate::generate_attachment_s3_key;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::document::FileTypeExt;
use model::response::ErrorResponse;
use model_file_type::{ContentType, FileType};
use models_email::service;
use models_email::service::link::Link;
use std::str::FromStr;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum AddDraftAttachmentError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Draft not found")]
    DraftNotFound,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for AddDraftAttachmentError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            AddDraftAttachmentError::Validation(_) => StatusCode::BAD_REQUEST,
            AddDraftAttachmentError::DraftNotFound => StatusCode::NOT_FOUND,
            AddDraftAttachmentError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
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
    /// The ID of the draft to add the attachment to.
    pub id: Uuid,
}

/// The request passed to send a message
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct AddDraftAttachmentRequest {
    /// The name of the file being uploaded.
    pub file_name: String,
    /// The SHA256 hash of the file being uploaded.
    pub sha: String,
    /// The size of the file in bytes.
    pub size: i32,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct AddDraftAttachmentResponse {
    /// The ID of the attachment in the database.
    pub attachment_id: Uuid,
    /// The URL to upload the attachment to.
    pub upload_url: String,
    /// The MIME type of the attachment.
    pub content_type: String,
}

/// Add an attachment to a draft.
#[utoipa::path(
    post,
    tag = "Drafts",
    path = "/email/drafts/{id}/attachments",
    operation_id = "add_draft_attachment",
    params(PathParams),
    request_body = AddDraftAttachmentRequest,
    responses(
        (status = 201, body = AddDraftAttachmentResponse),
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
    Path(PathParams { id: draft_id }): Path<PathParams>,
    Json(req): Json<AddDraftAttachmentRequest>,
) -> Result<Json<AddDraftAttachmentResponse>, AddDraftAttachmentError> {
    validate_request(&ctx, link.id, draft_id, &req).await?;

    let file_type = FileType::split_suffix_match(req.file_name.as_str())
        .and_then(|(_, extension)| FileType::from_str(extension).ok());
    let file_name = req.file_name;

    let content_type: ContentType = file_type.into();

    let attachment_id = macro_uuid::generate_uuid_v7();
    let s3_key = generate_attachment_s3_key!(draft_id, attachment_id);
    let mime_type = content_type.mime_type().to_string();

    let attachment = service::attachment::AttachmentDraft {
        id: attachment_id,
        draft_id,
        file_name: file_name.clone(),
        content_type: mime_type.clone(),
        sha: req.sha.clone(),
        size: req.size,
        s3_key: s3_key.clone(),
    };

    // insert attachment into db
    email_db_client::attachments::draft::insert_draft_attachment(&ctx.db, link.id, attachment)
        .await?;

    // generate presigned url
    let upload_url = ctx
        .s3_client
        .put_presigned_url(&ctx.config.attachment_bucket, &s3_key, &req.sha, &mime_type)
        .await?;

    Ok(Json(AddDraftAttachmentResponse {
        attachment_id,
        upload_url,
        content_type: mime_type.to_string(),
    }))
}

async fn validate_request(
    ctx: &ApiContext,
    link_id: Uuid,
    draft_id: Uuid,
    req: &AddDraftAttachmentRequest,
) -> Result<(), AddDraftAttachmentError> {
    if req.file_name.trim().is_empty() {
        return Err(AddDraftAttachmentError::Validation(
            "File name cannot be empty".to_string(),
        ));
    }
    if req.file_name.len() > 255 {
        return Err(AddDraftAttachmentError::Validation(
            "File name must be less than 256 characters".to_string(),
        ));
    }
    if req.sha.len() != 64 || !req.sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AddDraftAttachmentError::Validation(
            "SHA256 must be 64 hex characters".to_string(),
        ));
    }
    if req.size <= 0 {
        return Err(AddDraftAttachmentError::Validation(
            "File size must be greater than 0".to_string(),
        ));
    }

    // 25MB total encoded limit enforced by Gmail. Base64 adds ~33% overhead.
    // 25 / 1.33 = ~18.8MB. We use 18,000,000 bytes as the safe raw limit.
    const MAX_RAW_TOTAL_SIZE_BYTES: i32 = 18_000_000;

    if req.size > MAX_RAW_TOTAL_SIZE_BYTES {
        return Err(AddDraftAttachmentError::Validation(format!(
            "File size ({} bytes) exceeds the safe limit for email delivery (18MB).",
            req.size
        )));
    }

    // ensure draft exists. doing this late as possible in validation to avoid unnecessary db queries
    if !email_db_client::messages::get::draft_exists_with_id(&ctx.db, link_id, draft_id).await? {
        return Err(AddDraftAttachmentError::DraftNotFound);
    }

    let current_total_size =
        email_db_client::attachments::draft::get_total_attachments_size_by_draft_id(
            &ctx.db, link_id, draft_id,
        )
        .await?;

    if (current_total_size + req.size) > MAX_RAW_TOTAL_SIZE_BYTES {
        return Err(AddDraftAttachmentError::Validation(format!(
            "Combined attachments size exceeds the safe limit for email delivery (18MB). Current total: {} bytes.",
            current_total_size
        )));
    }

    Ok(())
}
