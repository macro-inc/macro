use super::attachment_error::AttachmentApiError;
use crate::api::context::{ApiContext, AuthorizationService, EmailSvc};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use email::inbound::axum::axum_impls::EmailLinkExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use utoipa::IntoParams;
use utoipa::ToSchema;
use uuid::Uuid;
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
#[tracing::instrument(skip_all, err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<EmailSvc, AuthorizationService>>,
    Path(PathParams { id: draft_id }): Path<PathParams>,
    Json(req): Json<AddForwardedAttachmentRequest>,
) -> Result<(StatusCode, Json<AddForwardedAttachmentResponse>), AttachmentApiError> {
    let actor = &authorization.authorization.user.macro_user_id;
    let attachment = ctx
        .draft_attachments
        .forward(actor, link.id, draft_id, req.attachment_id)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(AddForwardedAttachmentResponse {
            attachment_id: attachment.id,
            filename: attachment.filename,
            mime_type: attachment.mime_type,
            size_bytes: attachment.size_bytes,
        }),
    ))
}
