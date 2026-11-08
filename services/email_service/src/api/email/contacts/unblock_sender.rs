use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::{Extension, Json};
use email_types::service::link::Link;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use shared_types::response::ErrorResponse;
use utoipa::ToSchema;

/// Request to unblock a sender.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct UnblockSenderRequest {
    /// The email address of the sender to unblock.
    pub email_address: String,
}

/// Durably remove Macro-managed sender blocking in the selected inbox.
#[utoipa::path(
    post,
    tag = "Contacts",
    path = "/email/contacts/unblock",
    operation_id = "unblock_sender",
    request_body = UnblockSenderRequest,
    responses(
        (status = 204),
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
    Json(req): Json<UnblockSenderRequest>,
) -> Result<StatusCode, Response> {
    ctx.mailbox_settings
        .sender_block(
            &authorization.authorization.user.macro_user_id,
            link.id,
            &req.email_address,
            false,
        )
        .await
        .map_err(super::super::labels::settings_error)?;
    Ok(StatusCode::NO_CONTENT)
}
