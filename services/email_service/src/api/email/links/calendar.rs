use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::links::access::{InboxAccess, InboxActionError, authorize_inbox_access};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use calendar_events::domain::ports::{CalendarMutationError, CalendarMutationService};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use uuid::Uuid;

/// Turns calendar off for a connected inbox.
///
/// Removes the inbox's calendar data, drops the calendar scopes from its
/// recorded Google grant, and closes its push channels, so the inbox reads as
/// calendar-less until the user runs the calendar consent flow again. Gmail
/// sync is untouched.
///
/// Only the inbox's owner may do this: a delegate can see the owner's calendar
/// but must not be able to delete the owner's data.
#[utoipa::path(
    delete,
    tag = "Links",
    path = "/email/links/{link_id}/calendar",
    operation_id = "disable_link_calendar",
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
pub async fn disable_link_calendar_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(link_id): Path<Uuid>,
) -> Result<Response, InboxActionError> {
    let macro_user_id = &authorization.authorization.user.macro_user_id;
    let (_, access) = authorize_inbox_access(&ctx, macro_user_id.as_ref(), link_id).await?;
    if access == InboxAccess::Delegated {
        return Err(InboxActionError::Forbidden);
    }

    ctx.calendar_mutation_service
        .disconnect_calendar(macro_user_id.as_ref(), link_id)
        .await
        .map_err(|error| match error {
            CalendarMutationError::NotFound => InboxActionError::NotFound,
            error => InboxActionError::Internal(anyhow::anyhow!(
                "failed to disconnect the inbox calendar: {error:?}"
            )),
        })?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
