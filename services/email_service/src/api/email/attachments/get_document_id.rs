use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::drafts::attachment_error::AttachmentApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use utoipa::ToSchema;
use uuid::Uuid;

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
#[tracing::instrument(skip(ctx, authorization), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(attachment_id): Path<Uuid>,
) -> Result<Json<GetAttachmentDocumentIDResponse>, AttachmentApiError> {
    let document_id = ctx
        .attachment_reads
        .document(
            &authorization.authorization.user.macro_user_id,
            attachment_id,
        )
        .await?;
    Ok(Json(GetAttachmentDocumentIDResponse {
        attachment_id,
        document_id,
    }))
}
