use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::State;
use axum::response::Response;
use axum::{Extension, Json};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use utoipa::ToSchema;

/// Response containing list of blocked email addresses.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ListBlockedResponse {
    /// List of email addresses that are currently blocked.
    pub blocked_emails: Vec<String>,
}

/// List all blocked senders for the authenticated user.
#[utoipa::path(
    get,
    tag = "Contacts",
    path = "/email/contacts/blocked",
    operation_id = "list_blocked_senders",
    responses(
        (status = 200, body = ListBlockedResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, link, authorization), fields(link_id = %link.id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    link: Extension<Link>,
) -> Result<Json<ListBlockedResponse>, Response> {
    let blocked_emails = ctx
        .mailbox_settings
        .blocked_senders(&authorization.authorization.user.macro_user_id, link.id)
        .await
        .map_err(super::super::labels::settings_error)?;

    Ok(Json(ListBlockedResponse { blocked_emails }))
}
