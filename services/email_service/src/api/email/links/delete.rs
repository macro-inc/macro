use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::links::access::InboxActionError;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use email::domain::mailbox::lifecycle::InboxActor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use uuid::Uuid;

/// Removes a linked inbox.
///
/// For an inbox the caller owns this enqueues a full cascade teardown
/// (`LinkManagerMessage::DeleteLink`). For an inbox reached via delegation it
/// only drops the `macro_user_links` edge, leaving the owner's data intact.
#[utoipa::path(
    delete,
    tag = "Links",
    path = "/email/links/{link_id}",
    operation_id = "delete_link",
    params(
        ("link_id" = Uuid, Path, description = "Inbox link ID."),
    ),
    responses(
            (status = 204, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 403, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id), err)]
pub async fn delete_link_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(link_id): Path<Uuid>,
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
    ctx.inbox_lifecycle.remove(&actor, link_id).await?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
