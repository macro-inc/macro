use crate::api::context::ApiContext;
use crate::api::email::links::access::{InboxActionError, authorize_inbox_access};
use anyhow::Context;
use axum::Extension;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Json, Response};
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload,
};
use utoipa::ToSchema;
use uuid::Uuid;

/// The response returned from the resync endpoint.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ResyncResponse {
    /// The backfill job driving the (re-)sync. Either the freshly enqueued job or
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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id), err)]
pub async fn resync_link_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(link_id): Path<Uuid>,
) -> Result<Response, InboxActionError> {
    let (link, _access) = authorize_inbox_access(&ctx, &user_context.user_id, link_id).await?;

    if let Some(active) =
        email_db_client::backfill::job::get::get_active_backfill_job(&ctx.db, link.id)
            .await
            .context("failed to check active backfill job")?
    {
        return Ok(Json(ResyncResponse {
            backfill_job_id: active.id,
            already_in_progress: true,
        })
        .into_response());
    }

    let Some(backfill_job) = email_db_client::backfill::job::insert::create_backfill_job(
        &ctx.db,
        link.id,
        link.fusionauth_user_id.as_str(),
        None,
    )
    .await
    .context("failed to create backfill job")?
    else {
        // A concurrent request started the backfill between the check above and here.
        let active = email_db_client::backfill::job::get::get_active_backfill_job(&ctx.db, link.id)
            .await
            .context("failed to fetch active backfill job after insert conflict")?
            .context("backfill insert conflicted but no active job found")?;
        return Ok(Json(ResyncResponse {
            backfill_job_id: active.id,
            already_in_progress: true,
        })
        .into_response());
    };

    let ps_message = BackfillPubsubMessage {
        backfill_operation: BackfillOperation::Init(JobScopedPayload {
            link_id: link.id,
            job_id: backfill_job.id,
            payload: InitPayload {},
        }),
    };

    if let Err(e) = ctx
        .sqs_client
        .enqueue_email_backfill_message(ps_message)
        .await
    {
        if let Err(update_err) = email_db_client::backfill::job::update::update_backfill_job_status(
            &ctx.db,
            backfill_job.id,
            BackfillJobStatus::Failed,
        )
        .await
        {
            tracing::error!(error=?update_err, backfill_id=%backfill_job.id, "failed to mark backfill job failed");
        }

        return Err(e.context("failed to enqueue backfill message").into());
    }

    Ok(Json(ResyncResponse {
        backfill_job_id: backfill_job.id,
        already_in_progress: false,
    })
    .into_response())
}
