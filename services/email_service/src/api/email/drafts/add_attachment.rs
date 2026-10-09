use super::attachment_error::AttachmentApiError;
use crate::api::context::{ApiContext, AuthorizationService, EmailSvc};
use axum::{
    Json,
    extract::{Path, State},
};
use axum_extra::extract::Cached;
use email::{
    domain::draft_attachments::DraftAttachmentUpload, inbound::axum::axum_impls::EmailLinkExtractor,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use utoipa::IntoParams;
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(serde::Serialize, serde::Deserialize, Debug, IntoParams)]
pub struct PathParams {
    /// The ID of the draft to add the attachment to.
    pub id: Uuid,
}

/// The request passed to send a message
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct AddDraftAttachmentRequest {
    /// Stable client upload identifier. Retry the same file with the same ID.
    #[serde(default)]
    pub upload_id: Option<Uuid>,
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
#[tracing::instrument(skip_all, err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<EmailSvc, AuthorizationService>>,
    Path(PathParams { id: draft_id }): Path<PathParams>,
    Json(req): Json<AddDraftAttachmentRequest>,
) -> Result<Json<AddDraftAttachmentResponse>, AttachmentApiError> {
    let actor = &authorization.authorization.user.macro_user_id;
    let (attachment, upload_url) = ctx
        .draft_attachments
        .upload(
            actor,
            link.id,
            draft_id,
            DraftAttachmentUpload {
                file_name: req.file_name,
                sha: req.sha,
                size: req.size,
                upload_id: req.upload_id,
            },
        )
        .await?;
    Ok(Json(AddDraftAttachmentResponse {
        attachment_id: attachment.id,
        upload_url,
        content_type: attachment.content_type,
    }))
}
