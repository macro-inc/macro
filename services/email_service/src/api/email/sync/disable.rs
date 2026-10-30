use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::links::access::InboxActionError;
use axum::Extension;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use email::domain::mailbox::lifecycle::InboxActor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use models_email::email::service::link::Link;

/// Disables inbox syncing for the selected inbox.
///
/// The inbox is the caller's primary, or the one named by `X-Email-Link-Id`,
/// which may be an inbox the caller only reaches through delegation. Removal
/// therefore follows the same policy as `DELETE /email/links/{link_id}`: an
/// owner's inbox is torn down, while a delegate only loses their
/// `macro_user_links` edge and the owner's data stays intact.
#[utoipa::path(
    delete,
    tag = "Sync",
    path = "/email/sync",
    operation_id = "disable_sync",
    params(
        ("X-Email-Link-Id" = Option<uuid::Uuid>, Header, description = "Inbox link ID to act on instead of the caller's primary inbox; may name a delegated inbox."),
    ),
    responses(
            (status = 204, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 403, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 409, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, link), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id, link_id=%link.id), err)]
pub async fn disable_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Extension(link): Extension<Link>,
) -> Result<Response, InboxActionError> {
    let actor = InboxActor {
        macro_id: authorization.authorization.user.macro_user_id.clone(),
        credential_owner: authorization
            .authorization
            .user
            .user_context
            .fusion_user_id
            .to_string(),
    };
    ctx.inbox_lifecycle.remove(&actor, link.id).await?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
