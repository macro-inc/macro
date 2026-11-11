use super::*;
use crate::domain::backfill_jobs::BackfillJobRepository;
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::service::{
    backfill::*,
    link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
use uuid::Uuid;

#[tracing::instrument(skip_all)]
pub(super) async fn inner_process_message<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    data: &BackfillPubsubMessage,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    match &data.backfill_operation {
        BackfillOperation::Init(scope) => {
            let Some(JobContextNoToken { link, backfill_job }) =
                fetch_job_context_no_token(ctx, scope, false).await?
            else {
                return Ok(());
            };
            ctx.legacy.init(scope, &link, &backfill_job).await
        }
        BackfillOperation::ListThreads(scope) => {
            let Some(JobContextNoToken { link, backfill_job }) =
                fetch_job_context_no_token(ctx, scope, false).await?
            else {
                return Ok(());
            };
            ctx.legacy.list_threads(scope, &link, &backfill_job).await
        }
        BackfillOperation::BackfillThread(scope) => {
            let Some(JobContextNoToken { link, .. }) =
                fetch_job_context_no_token(ctx, scope, false).await?
            else {
                return Ok(());
            };
            ctx.legacy.backfill_thread(scope, &link).await
        }
        BackfillOperation::BackfillMessage(scope) => {
            let Some(JobContextNoToken { link, .. }) =
                fetch_job_context_no_token(ctx, scope, false).await?
            else {
                // BackfillMessage owns per-thread progress in addition to
                // the job-level progress that fetch_job_context already
                // cleared on cancellation. Drop it so a re-run of the
                // cancelled job doesn't see stale thread counters.
                ctx.effects
                    .delete_thread_progress(scope.job_id, &scope.payload.thread_provider_id)
                    .await;
                return Ok(());
            };
            ctx.legacy.backfill_message(scope, &link).await
        }
        BackfillOperation::UpdateThreadMetadata(scope) => {
            // UpdateThreadMetadata is a DB-only step; skip the Gmail token
            // fetch so a revoked token can't fail this handler with
            // AccessTokenFetchFailed.
            let Some(JobContextNoToken { link, .. }) =
                fetch_job_context_no_token(ctx, scope, false).await?
            else {
                return Ok(());
            };
            metadata::update_thread_metadata(ctx, scope, &link).await
        }
        BackfillOperation::BackfillAttachment(scope) => {
            let Some(JobContextNoToken { link, .. }) =
                fetch_job_context_no_token(ctx, scope, true).await?
            else {
                return Ok(());
            };
            attachment::backfill_attachment(ctx, &link, &scope.payload).await
        }
        BackfillOperation::FinalizeBackfill(scope) => {
            ctx.legacy.finalize(scope.link_id, scope.job_id).await
        }
        BackfillOperation::SeedSentContact(scope) => {
            let Some(JobContextNoToken { link, .. }) =
                fetch_job_context_no_token(ctx, scope, false).await?
            else {
                return Ok(());
            };
            seed::seed_sent_contact(ctx, scope, &link).await
        }
        BackfillOperation::PopulateCrmContact(scope) => {
            let Some(link) = fetch_link_if_present(ctx, scope.link_id).await? else {
                return Ok(());
            };
            crm::populate_crm_contact(ctx, &link, &scope.payload).await
        }
        BackfillOperation::DepopulateCrmContact(scope) => {
            let Some(link) = fetch_link_if_present(ctx, scope.link_id).await? else {
                return Ok(());
            };
            crm::depopulate_crm_contact(ctx, &link, &scope.payload).await
        }
        BackfillOperation::PopulateCrmForUser(payload) => {
            crm::populate_crm_for_user(ctx, payload).await
        }
        BackfillOperation::DepopulateCrmForUser(payload) => {
            crm::depopulate_crm_for_user(ctx, payload).await
        }
    }
}

/// Job admission facts without a Gmail access token. Used by
/// handlers that do not require a raw Gmail access token. Provider operations
/// can still fetch tokens through `email_api`.
struct JobContextNoToken {
    link: link::Link,
    backfill_job: BackfillJob,
}

/// Shared prefetch for DB-only job-scoped handlers: loads the backfill
/// job, short-circuits on cancellation (also cleaning up the job-level
/// redis progress key), and loads the link. Returns `Ok(None)` when the
/// parent backfill job is failed or cancelled, and normally when it is
/// complete. Completion follow-up operations may opt into running after the
/// terminal transition. Variant-specific cancellation cleanup (e.g.
/// per-thread progress keys) belongs at the call site, not here.
async fn fetch_job_context_no_token<R, G, Q, E, C, L, P>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    scope: &JobScopedPayload<P>,
    allow_complete: bool,
) -> Result<Option<JobContextNoToken>, ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    let backfill_job = ctx
        .repository
        .jobs()
        .job(scope.job_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.into_original().context("Failed to fetch backfill job"),
            })
        })?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::BackfillJobNotFound,
                source: anyhow::anyhow!("Backfill job not found"),
            })
        })?;

    if matches!(
        backfill_job.status,
        BackfillJobStatus::Cancelled | BackfillJobStatus::Failed
    ) || (backfill_job.status == BackfillJobStatus::Complete && !allow_complete)
    {
        ctx.effects.delete_job_progress(scope.job_id).await;
        return Ok(None);
    }

    let link = fetch_link(ctx, scope.link_id).await?;

    Ok(Some(JobContextNoToken { link, backfill_job }))
}

/// Looks up a link by id, mapping the absence into a NonRetryable error
/// (the message names a link that doesn't exist; retrying won't help).
async fn fetch_link<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    link_id: Uuid,
) -> Result<link::Link, ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    match ctx.repository.link(link_id).await {
        Ok(Some(link)) => Ok(link),
        Ok(None) => {
            let err_msg = format!("Link not found for link_id: {link_id}");
            tracing::error!("{}", err_msg);
            Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::LinkNotFound,
                source: anyhow::anyhow!(err_msg),
            }))
        }
        Err(e) => Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.into_original(),
        })),
    }
}

/// Looks up the link a link-scoped CRM message was fanned out for.
///
/// Returns `None` once the link is deleted: link teardown already removed the
/// link's CRM rows, so messages still queued for it have nothing left to do.
async fn fetch_link_if_present<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    link_id: Uuid,
) -> Result<Option<link::Link>, ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    let link = ctx.repository.link(link_id).await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.into_original(),
        })
    })?;
    if link.is_none() {
        tracing::debug!(%link_id, "Link was deleted; dropping link-scoped CRM message");
    }
    Ok(link)
}
