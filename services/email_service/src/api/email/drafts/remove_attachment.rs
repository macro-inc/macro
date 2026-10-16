use super::attachment_error::AttachmentApiError;
use crate::api::context::{ApiContext, AuthorizationService, EmailSvc};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use axum_extra::extract::Cached;
use email::inbound::axum::axum_impls::EmailLinkExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::EmptyResponse;
use model::response::ErrorResponse;
use utoipa::IntoParams;
use uuid::Uuid;
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
#[tracing::instrument(skip_all, err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<EmailSvc, AuthorizationService>>,
    Path(PathParams {
        id: draft_id,
        attachment_id,
    }): Path<PathParams>,
) -> Result<impl IntoResponse, AttachmentApiError> {
    let actor = &authorization.authorization.user.macro_user_id;
    ctx.draft_attachments
        .remove(
            actor,
            link.id,
            draft_id,
            attachment_id,
            email::domain::draft_attachments::RemovalKind::UploadedOrNative,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
