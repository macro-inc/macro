use crate::api::context::{ApiContext, AuthorizationService, EmailSvc};
use axum::{
    extract::{Path, State},
    http::StatusCode,
};
use axum_extra::extract::Cached;
use email::domain::scheduled::{EmailSchedulingService, ScheduleChange};
use email::inbound::axum::axum_impls::EmailLinkExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use uuid::Uuid;

use super::upsert::UpsertScheduledError;

/// Remove the scheduled send from a draft, including immediate-send undo.
#[utoipa::path(
    delete, tag = "Draft Scheduling", path = "/email/drafts/scheduled/{message_id}",
    operation_id = "delete_scheduled_draft",
    params(("message_id" = Uuid, Path, description = "The ID of the draft")),
    responses(
        (status = 204, description = "Scheduled send deleted successfully"),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, link), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Cached(authorization): Cached<
        MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    >,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<EmailSvc, AuthorizationService>>,
    Path(message_id): Path<Uuid>,
) -> Result<StatusCode, UpsertScheduledError> {
    ctx.email_service
        .service()
        .change_schedule(
            authorization.authorization.user.macro_user_id.clone(),
            link.id,
            message_id,
            ScheduleChange::Cancel,
            None,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
