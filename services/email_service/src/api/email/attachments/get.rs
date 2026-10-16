use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::drafts::attachment_error::AttachmentApiError;
use axum::{
    Json,
    extract::{Path, State},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use models_email::service::attachment;
use utoipa::ToSchema;
use uuid::Uuid;

/// The response returned from the get attachment endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetAttachmentResponse {
    pub attachment: attachment::Attachment,
}

/// Get an attachment by ID.
#[utoipa::path(
    get,
    tag = "Attachments",
    path = "/email/attachments/{id}",
    operation_id = "get_attachment",
    params(
        ("id" = Uuid, Path, description = "Attachment ID."),
    ),
    responses(
            (status = 200, body=GetAttachmentResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 403, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 409, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<GetAttachmentResponse>, AttachmentApiError> {
    let attachment = ctx
        .attachment_reads
        .download(&authorization.authorization.user.macro_user_id, id)
        .await?;
    Ok(Json(GetAttachmentResponse { attachment }))
}
