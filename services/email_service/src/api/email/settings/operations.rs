use crate::api::context::{ApiContext, AuthorizationService};
use axum::{Extension, Json, extract::State, response::Response};
use email::domain::mailbox::settings::MailboxSettingsOperation;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use models_email::service::link::Link;

/// Accepted label and sender-policy changes awaiting provider confirmation.
#[utoipa::path(get,tag="Settings",path="/email/settings/operations",operation_id="mailbox_settings_operations",
    responses((status=200,body=Vec<MailboxSettingsOperation>)))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    link: Extension<Link>,
) -> Result<Json<Vec<MailboxSettingsOperation>>, Response> {
    ctx.mailbox_settings
        .pending_operations(&authorization.authorization.user.macro_user_id, link.id)
        .await
        .map(Json)
        .map_err(super::super::labels::settings_error)
}
