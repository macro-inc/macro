use crate::pubsub::crm_cleanup::worker::CrmCleanupContext;
use crm::domain::service::CrmService;
use email_db_client::crm_cleanup::{candidates, job};
use models_email::email::service::crm_cleanup::{
    CrmCleanupJobStatus, CrmCleanupOperation, CrmCleanupPubsubMessage,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use std::collections::HashSet;
use uuid::Uuid;

/// Candidates dispatched per ListCandidates message.
const CANDIDATE_PAGE_SIZE: i64 = 200;

/// A candidate younger than this is never pruned on a negative source lookup,
/// only dispatched. Populate is enqueued asynchronously and is always queued
/// *before* the deletion that records the candidate, so a row this old means
/// populate has had at least this long to commit its `crm_contact_sources`
/// row. Without the guard, a populate still in flight at 08:00 could land
/// right after the lookup missed, leaving a CRM row whose candidate we already
/// pruned. Candidates accumulate over 24h, so in practice this exempts almost
/// nothing.
const PRUNE_MIN_AGE: chrono::TimeDelta = chrono::TimeDelta::hours(6);

/// Dispatches one keyset page of cleanup candidates as `ProcessCandidate`
/// messages, then re-enqueues itself with the new cursor. Mirrors the
/// backfill `list_threads` pattern: each page is its own SQS message, so a
/// crash resumes from the last acked page. A short page means every id up to
/// the job's `max_candidate_id` snapshot has been dispatched — the job is
/// marked `Complete`.
///
/// Before fanning out, the page is filtered against `crm_contact_sources`:
/// candidates are written on every message deletion, but CRM only tracks a
/// small subset of correspondents, so most pairs have nothing to tear down.
/// Those are claimed in one batch instead of costing a message each. The
/// filter runs here rather than at insert time because populate is enqueued
/// asynchronously — at deletion the contact may not be in CRM *yet*, and
/// skipping it there would strand the row forever. By the nightly run,
/// populate has long since settled.
#[tracing::instrument(skip(ctx), err)]
pub async fn list_candidates(
    ctx: &CrmCleanupContext,
    job_id: Uuid,
    last_id: i64,
) -> Result<(), ProcessingError> {
    let job = job::get_job(&ctx.db, job_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch crm cleanup job"),
            })
        })?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::InvalidData,
                source: anyhow::anyhow!("Crm cleanup job not found: {job_id}"),
            })
        })?;

    match job.status {
        CrmCleanupJobStatus::Init | CrmCleanupJobStatus::InProgress => {}
        CrmCleanupJobStatus::Complete | CrmCleanupJobStatus::Failed => {
            tracing::warn!(job_id = %job_id, status = %job.status, "Stale ListCandidates message for finished job; acking");
            return Ok(());
        }
    }

    let page = candidates::list_candidates_page(
        &ctx.db,
        last_id,
        job.max_candidate_id,
        CANDIDATE_PAGE_SIZE,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to list crm cleanup candidates"),
        })
    })?;

    let pairs: Vec<(Uuid, String)> = page
        .iter()
        .map(|c| (c.link_id, c.contact_email.clone()))
        .collect();

    // Pairs too young to prune safely — see PRUNE_MIN_AGE. Dispatched
    // unconditionally, which is exactly the pre-filter behaviour.
    let prune_cutoff = chrono::Utc::now() - PRUNE_MIN_AGE;
    let too_young: HashSet<(Uuid, String)> = page
        .iter()
        .filter(|c| c.created_at > prune_cutoff)
        .map(|c| (c.link_id, c.contact_email.clone()))
        .collect();

    let actionable: HashSet<(Uuid, String)> = ctx
        .crm_service
        .link_contact_pairs_with_sources(&pairs)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e)
                    .context("Failed to filter crm cleanup candidates by contact sources"),
            })
        })?
        .into_iter()
        .collect();

    // The repo lowercases the emails it echoes back, so compare on the same
    // footing — candidate rows are already normalized on insert, but a stray
    // mixed-case row must not silently fall out of the actionable set.
    let (to_dispatch, to_prune): (Vec<_>, Vec<_>) = pairs.into_iter().partition(|pair| {
        let (link_id, email) = pair;
        actionable.contains(&(*link_id, email.to_ascii_lowercase())) || too_young.contains(pair)
    });

    // Nothing to tear down for these: retire them here rather than spending a
    // ProcessCandidate message each to reach the same conclusion. Runs before
    // any dispatch, so a failure retries the whole page cleanly.
    if !to_prune.is_empty() {
        let pruned = candidates::claim_candidates(&ctx.db, &to_prune)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to prune crm cleanup candidates"),
                })
            })?;
        tracing::info!(
            job_id = %job_id,
            pruned,
            dispatching = to_dispatch.len(),
            "Pruned crm cleanup candidates with no contact sources"
        );
    }

    for (link_id, contact_email) in &to_dispatch {
        ctx.sqs_client
            .enqueue_email_crm_cleanup_message(CrmCleanupPubsubMessage {
                operation: CrmCleanupOperation::ProcessCandidate {
                    link_id: *link_id,
                    contact_email: contact_email.clone(),
                },
            })
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue ProcessCandidate message"),
                })
            })?;
    }

    // Observability only; may over-count when a page is redelivered mid-dispatch.
    if !to_dispatch.is_empty() {
        job::add_dispatched_count(&ctx.db, job_id, to_dispatch.len() as i64)
            .await
            .inspect_err(|e| tracing::error!(error = ?e, "Failed to bump dispatched_count"))
            .ok();
    }

    if page.len() as i64 == CANDIDATE_PAGE_SIZE {
        let next_cursor = page.last().map(|c| c.id).unwrap_or(last_id);
        ctx.sqs_client
            .enqueue_email_crm_cleanup_message(CrmCleanupPubsubMessage {
                operation: CrmCleanupOperation::ListCandidates {
                    job_id,
                    last_id: next_cursor,
                },
            })
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to re-enqueue ListCandidates message"),
                })
            })?;
    } else {
        job::set_job_status(&ctx.db, job_id, CrmCleanupJobStatus::Complete)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to mark crm cleanup job complete"),
                })
            })?;
        tracing::info!(job_id = %job_id, dispatched = job.dispatched_count + to_dispatch.len() as i64, "Crm cleanup job dispatch complete");
    }

    Ok(())
}
