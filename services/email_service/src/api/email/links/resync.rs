use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::links::access::InboxActionError;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Json, Response};
use email::domain::mailbox::lifecycle::InboxActor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use utoipa::ToSchema;
use uuid::Uuid;

/// The response returned from the resync endpoint.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ResyncResponse {
    /// Opaque ID of the backfill job or provider sync stream driving the resync.
    /// the one already in progress.
    pub backfill_job_id: Uuid,
    /// True when a backfill was already running and this call was a no-op.
    pub already_in_progress: bool,
}

/// Re-syncs a linked inbox by enqueuing a fresh backfill.
///
/// Idempotent: if a backfill is already `Init`/`InProgress` for the inbox this is
/// a no-op and returns that job.
#[utoipa::path(
    post,
    tag = "Links",
    path = "/email/links/{link_id}/resync",
    operation_id = "resync_link",
    params(
        ("link_id" = Uuid, Path, description = "Inbox link ID."),
    ),
    responses(
            (status = 200, body=ResyncResponse),
            (status = 401, body=ErrorResponse),
            (status = 403, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id), err)]
pub async fn resync_link_handler(
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
    let result = ctx.inbox_lifecycle.resync(&actor, link_id).await?;
    Ok(Json(ResyncResponse {
        backfill_job_id: result.run_id,
        already_in_progress: result.already_in_progress,
    })
    .into_response())
}
