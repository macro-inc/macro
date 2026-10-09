use super::attachment_error::AttachmentApiError;
use crate::api::context::{ApiContext, AuthorizationService, EmailSvc};
use axum::{
    extract::{Path, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use email::inbound::axum::axum_impls::EmailLinkExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use uuid::Uuid;

/// Confirm an uploaded attachment before it becomes part of a sendable draft.
#[utoipa::path(post, tag = "Drafts", path = "/email/drafts/{id}/attachments/{attachment_id}/complete",
    operation_id = "complete_draft_attachment", params(("id" = Uuid, Path), ("attachment_id" = Uuid, Path)),
    responses((status = 204), (status = 400), (status = 403), (status = 404), (status = 409), (status = 500)))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<EmailSvc, AuthorizationService>>,
    Path((draft, attachment)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AttachmentApiError> {
    ctx.draft_attachments
        .complete_upload(
            &authorization.authorization.user.macro_user_id,
            link.id,
            draft,
            attachment,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
