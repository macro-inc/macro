use crate::api::context::ApiContext;
use crate::api::email::validation::ValidationError;
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
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum AddDraftAttachmentError {
    #[error("Validation error: {0}")]
    Validation(#[from] ValidationError),

    #[error("Draft not found")]
    DraftNotFound,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for AddDraftAttachmentError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            AddDraftAttachmentError::Validation(e) => e.status_code(),
            AddDraftAttachmentError::DraftNotFound => StatusCode::NOT_FOUND,
            AddDraftAttachmentError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "AddDraftAttachmentError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

/// The request passed to send a message
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct AddDraftAttachmentRequest {
    pub file_name: String,
    pub sha: String,
    pub size: i32,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct AddDraftAttachmentResponse {
    pub attachment_id: Uuid,
    pub upload_url: String,
    pub content_type: String,
}

/// Add an attachment to a draft.
#[utoipa::path(
    post,
    tag = "Drafts",
    path = "/email/drafts/{id}/attachments",
    operation_id = "add_draft_attachment",
    request_body = AddDraftAttachmentRequest,
    responses(
        (status = 201, body = AddDraftAttachmentResponse),
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
    Path(PathParams { id: draft_id }): Path<PathParams>,
    Json(req): Json<AddDraftAttachmentRequest>,
) -> Result<Json<AddDraftAttachmentResponse>, AddDraftAttachmentError> {
    // ensure draft exists
    if !email_db_client::messages::get::draft_exists_with_id(&ctx.db, link.id, draft_id).await? {
        return Err(AddDraftAttachmentError::DraftNotFound);
    }

    let (file_name, file_type) = match FileType::split_suffix_match(req.file_name.as_str()) {
        Some((file_name, extension)) => {
            let file_type: Option<FileType> = FileType::from_str(extension).ok();
            (file_name.to_string(), file_type)
        }
        None => (req.file_name, None),
    };

    let content_type: ContentType = file_type.into();

    let attachment_id = macro_uuid::generate_uuid_v7();
    let s3_key = format!("draft/{}/{}", draft_id, attachment_id);
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
    email_db_client::attachments::draft::insert_draft_attachment(&ctx.db, attachment).await?;

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
