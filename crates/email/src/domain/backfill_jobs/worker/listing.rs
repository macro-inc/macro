use super::email_api_error::map_email_api_error;
use super::*;
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::gmail::labels::SystemLabelID;
use models_email::service::thread::ListThreadsPayload;
use models_email::service::{
    backfill::*,
    link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
use std::cmp::min;
// the max size allowed by the gmail api
const BACKFILL_THREAD_BATCH_SIZE: u32 = 500;

// How many of the user's most important (CATEGORY_PERSONAL) threads the
// priority pass seeds first, before handing off to the normal sweep.
const PRIORITY_PASS_THREAD_LIMIT: u32 = 200;

// How many of the user's most recent sent messages we seed the contacts
// service from during the priority pass (the gmail api caps this at 500).
const SENT_CONTACT_SEED_LIMIT: u32 = 200;

/// This step is invoked by Init.
/// Each ListThreads operation gets a batch of 500 thread_ids from the gmail api
/// and sends a BackfillThread message for each thread_id in the batch. If there
/// are still threads left to fetch, it will trigger another ListThreads message
/// to be created, looping until all threads requiring population have been listed.
///
/// The very first ListThreads (enqueued by Init) is a `priority_pass`: it lists
/// only the user's most important threads first, then hands off to this normal
/// most-recent-to-least sweep.
pub(super) async fn list_threads<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    scope: &JobScopedPayload<ListThreadsPayload>,
    link: &link::Link,
    job: &BackfillJob,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    if scope.payload.priority_pass {
        return list_priority_threads(ctx, scope, link, job).await;
    }

    let p = &scope.payload;
    let total_threads = job.total_threads;
    let threads_retrieved_count = job.threads_retrieved_count;

    let num_threads_to_list = min(
        BACKFILL_THREAD_BATCH_SIZE as i32,
        total_threads - threads_retrieved_count,
    );

    // get batch of thread ids
    let thread_list = ctx
        .gmail
        .list_threads(
            link.id,
            num_threads_to_list as u32,
            p.next_page_token.as_deref(),
            &[],
        )
        .await
        .map_err(|error| map_email_api_error(error, "Failed to list provider threads"))?;

    // pass along token if it exists for fetching next batch of thread_ids
    let next_page_token = thread_list.next_page_token.clone();
    let threads = thread_list.threads;

    // add the threads we just discovered to the job counter
    ctx.repository
        .retrieved_threads(scope.job_id, threads.len() as i32)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .source
                    .context("Failed to update backfill job num_threads"),
            })
        })?;

    // send a pubsub message for each discovered thread
    for thread in &threads {
        let thread_sqs_msg = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::BackfillThread(JobScopedPayload {
                link_id: scope.link_id,
                job_id: scope.job_id,
                payload: BackfillThreadPayload {
                    thread_provider_id: thread.provider_id.clone(),
                    refresh_existing: p.refresh_existing,
                },
            }),
        };

        ctx.queue.enqueue(thread_sqs_msg).await.map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e
                    .into_original()
                    .context(format!("Failed to enqueue thread {}", thread.provider_id)),
            })
        })?;
    }

    // if we have more threads to fetch, send another pubsub message
    if next_page_token.is_some() {
        let list_thread_msg = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::ListThreads(JobScopedPayload {
                link_id: scope.link_id,
                job_id: scope.job_id,
                payload: ListThreadsPayload {
                    next_page_token,
                    priority_pass: false,
                    refresh_existing: p.refresh_existing,
                },
            }),
        };

        ctx.queue.enqueue(list_thread_msg).await.map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e
                    .into_original()
                    .context("Failed to enqueue list threads message".to_string()),
            })
        })?;
    } else if threads.is_empty() && threads_retrieved_count == 0 {
        // A truly empty mailbox is completed in init_backfill (total_threads
        // is 0 there). Reaching here means the profile reported threads but
        // the listing returned none, so no per-thread message was ever
        // enqueued and the per-thread completion path will never finalize the
        // job. Complete it here.
        ctx.legacy.completed_job(scope.job_id).await?;
        let _ = ctx
            .effects
            .delete_listing_progress(scope.job_id)
            .await
            .inspect_err(|e| tracing::error!(error = ?e, "Failed to delete backfill job progress"));
    }

    Ok(())
}

/// The priority first pass (see [`ListThreadsPayload::priority_pass`]). Does a
/// single CATEGORY_PERSONAL-filtered listing of up to `PRIORITY_PASS_THREAD_LIMIT`
/// threads, enqueues a BackfillThread for each, bumps the job's redis total to
/// account for the normal sweep re-covering these same threads, then hands off
/// to the normal sweep. Unlike the normal pass it does not paginate and does
/// not touch `threads_retrieved_count` (that counter drives the normal sweep's
/// batch math and must stay equal to the real mailbox count).
async fn list_priority_threads<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    scope: &JobScopedPayload<ListThreadsPayload>,
    link: &link::Link,
    job: &BackfillJob,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    // Never request more than the job's overall thread budget (which already
    // accounts for any requested limit set at job creation).
    let num_threads_to_list = min(PRIORITY_PASS_THREAD_LIMIT as i32, job.total_threads);

    if num_threads_to_list > 0 {
        // CATEGORY_PERSONAL is Gmail's "important to a human" bucket; seeding
        // these first means a brand-new user sees signal immediately.
        let thread_list = ctx
            .gmail
            .list_threads(
                link.id,
                num_threads_to_list as u32,
                None,
                &[SystemLabelID::CategoryPersonal.as_str()],
            )
            .await
            .map_err(|error| {
                map_email_api_error(error, "Failed to list priority provider threads")
            })?;

        let threads = thread_list.threads;

        // Bump the job total to cover these extra BackfillThread messages: the
        // normal sweep re-covers the same threads and re-increments the
        // completed counter via the skip path, so without this the
        // `completed >= total` check would finalize the job early. Bump before
        // enqueuing so no priority thread can complete against a stale total;
        // after this only non-retryable enqueues remain, so a retry can't
        // double-bump.
        if !threads.is_empty() {
            ctx.effects
                .add_total_threads(scope.job_id, threads.len() as i32)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::RedisQueryFailed,
                        source: e.context("Failed to bump total_threads for priority pass"),
                    })
                })?;
        }

        for thread in &threads {
            let thread_sqs_msg = BackfillPubsubMessage {
                backfill_operation: BackfillOperation::BackfillThread(JobScopedPayload {
                    link_id: scope.link_id,
                    job_id: scope.job_id,
                    payload: BackfillThreadPayload {
                        thread_provider_id: thread.provider_id.clone(),
                        refresh_existing: false,
                    },
                }),
            };

            ctx.queue.enqueue(thread_sqs_msg).await.map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.into_original().context(format!(
                        "Failed to enqueue priority thread {}",
                        thread.provider_id
                    )),
                })
            })?;
        }
    }

    // Seed the contacts service from the user's recent sent mail so a new user
    // has contacts before full backfill completes. Best-effort: this runs after
    // the priority-pass total_threads bump, so it must never return a retryable
    // error (that would re-run the pass and double-bump the counter).
    if ctx.contacts_sync {
        enqueue_sent_contact_seeds(ctx, scope, link).await;
    }

    // Hand off to the normal most-recent-to-least sweep from the beginning. This
    // runs regardless of how many priority threads were found.
    let list_thread_msg = BackfillPubsubMessage {
        backfill_operation: BackfillOperation::ListThreads(JobScopedPayload {
            link_id: scope.link_id,
            job_id: scope.job_id,
            payload: ListThreadsPayload {
                next_page_token: None,
                priority_pass: false,
                refresh_existing: scope.payload.refresh_existing,
            },
        }),
    };

    ctx.queue.enqueue(list_thread_msg).await.map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: e
                .into_original()
                .context("Failed to enqueue normal ListThreads after priority pass".to_string()),
        })
    })?;

    Ok(())
}

/// Lists the user's most recent sent messages and fans out one
/// [`BackfillOperation::SeedSentContact`] per message so the contacts service
/// gets seeded early in the backfill (see [`list_priority_threads`]).
///
/// Best-effort by design: it runs after the priority pass has already bumped
/// `total_threads`, so it must not propagate a retryable error (that would
/// re-run the whole pass and double-bump). On any failure it logs and returns —
/// `handle_contacts_sync` re-seeds the full contact set at job completion.
async fn enqueue_sent_contact_seeds<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    scope: &JobScopedPayload<ListThreadsPayload>,
    link: &link::Link,
) where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    use models_email::email::service::backfill::SeedSentContactPayload;

    let message_ids = match ctx
        .gmail
        .list_messages(
            link.id,
            SENT_CONTACT_SEED_LIMIT,
            &[SystemLabelID::Sent.as_str()],
        )
        .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::error!(error = ?e, link_id = %link.id, "Skipping sent-contact seed: failed to list provider sent messages");
            return;
        }
    };

    for message_provider_id in message_ids {
        let msg = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::SeedSentContact(JobScopedPayload {
                link_id: scope.link_id,
                job_id: scope.job_id,
                payload: SeedSentContactPayload {
                    message_provider_id: message_provider_id.clone(),
                },
            }),
        };

        if let Err(e) = ctx.queue.enqueue(msg).await {
            tracing::error!(error = ?e, link_id = %link.id, message_id = %message_provider_id, "Failed to enqueue sent-contact seed; skipping remaining");
            return;
        }
    }
}
