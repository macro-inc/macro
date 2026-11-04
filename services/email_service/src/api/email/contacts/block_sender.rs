use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::{Extension, Json};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use utoipa::ToSchema;

/// Request to block a sender.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct BlockSenderRequest {
    /// The email address of the sender to block.
    pub email_address: String,
}

/// Durably block a sender in the selected inbox.
#[utoipa::path(
    post,
    tag = "Contacts",
    path = "/email/contacts/block",
    operation_id = "block_sender",
    request_body = BlockSenderRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, link, req, authorization), fields(link_id = %link.id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    link: Extension<Link>,
    Json(req): Json<BlockSenderRequest>,
) -> Result<StatusCode, Response> {
    ctx.mailbox_settings
        .sender_block(
            &authorization.authorization.user.macro_user_id,
            link.id,
            &req.email_address,
            true,
        )
        .await
        .map_err(super::super::labels::settings_error)?;
    Ok(StatusCode::OK)
}
