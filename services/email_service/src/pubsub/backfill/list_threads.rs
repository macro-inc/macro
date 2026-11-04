use super::db_error::map_db_error;
use super::email_api_error::map_email_api_error;
use crate::pubsub::context::PubSubContext;
use email_db_client::backfill::progress::{self, ListingPage};
use models_email::email::service::backfill::{
    BackfillJob, BackfillOperation, BackfillPubsubMessage, BackfillThreadPayload, JobScopedPayload,
};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::email::service::thread::ListThreadsPayload;
use models_email::gmail::labels::SystemLabelID;

const BACKFILL_THREAD_BATCH_SIZE: i32 = 500;
const PRIORITY_PASS_THREAD_LIMIT: i32 = 200;
#[cfg(feature = "contacts_sync")]
const SENT_CONTACT_SEED_LIMIT: u32 = 200;

/// Persist each provider page and its thread identities before publishing.
/// A retry republishes the same page, so ambiguous sends and duplicate listing
/// deliveries cannot inflate progress or lose a continuation.
#[tracing::instrument(skip(ctx, scope, link, job), fields(job_id = %scope.job_id), err)]
pub async fn list_threads(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<ListThreadsPayload>,
    link: &link::Link,
    job: &BackfillJob,
) -> Result<(), ProcessingError> {
    let p = &scope.payload;
    let key = p.next_page_token.as_deref().unwrap_or_default();
    let saved = progress::get_page(&ctx.db, scope.job_id, p.priority_pass, key)
        .await
        .map_err(|e| map_db_error(e, "Failed to read saved backfill page"))?;
    let page = match saved {
        Some(page) => page,
        None => {
            let remaining = if p.priority_pass {
                job.total_threads.min(PRIORITY_PASS_THREAD_LIMIT)
            } else {
                job.threads_requested_limit
                    .map(|limit| (limit - job.threads_retrieved_count).max(0))
                    .unwrap_or(i32::MAX)
            };
            let page = if remaining == 0 {
                ListingPage {
                    thread_provider_ids: Vec::new(),
                    next_page_token: None,
                }
            } else {
                let labels = if p.priority_pass {
                    vec![SystemLabelID::CategoryPersonal.as_str()]
                } else {
                    vec![]
                };
                let listed = ctx
                    .email_api
                    .list_threads(
                        link.id,
                        remaining.min(BACKFILL_THREAD_BATCH_SIZE) as u32,
                        p.next_page_token.as_deref(),
                        &labels,
                    )
                    .await
                    .map_err(|e| map_email_api_error(e, "Failed to list backfill threads"))?;
                let ids: Vec<String> = listed.threads.into_iter().map(|t| t.provider_id).collect();
                let next_page_token = if p.priority_pass || ids.len() >= remaining as usize {
                    None
                } else {
                    listed.next_page_token
                };
                ListingPage {
                    thread_provider_ids: ids,
                    next_page_token,
                }
            };
            progress::register_page(&ctx.db, scope.job_id, p.priority_pass, key, page)
                .await
                .map_err(|e| map_db_error(e, "Failed to register backfill page"))?
        }
    };

    for thread in &page.thread_provider_ids {
        ctx.sqs_client
            .enqueue_email_backfill_message(BackfillPubsubMessage {
                backfill_operation: BackfillOperation::BackfillThread(JobScopedPayload {
                    link_id: scope.link_id,
                    job_id: scope.job_id,
                    payload: BackfillThreadPayload {
                        thread_provider_id: thread.clone(),
                        refresh_existing: p.refresh_existing,
                    },
                }),
            })
            .await
            .map_err(publish_error)?;
    }

    #[cfg(feature = "contacts_sync")]
    if p.priority_pass {
        enqueue_sent_contact_seeds(ctx, scope, link).await;
    }

    if p.priority_pass || page.next_page_token.is_some() {
        ctx.sqs_client
            .enqueue_email_backfill_message(BackfillPubsubMessage {
                backfill_operation: BackfillOperation::ListThreads(JobScopedPayload {
                    link_id: scope.link_id,
                    job_id: scope.job_id,
                    payload: ListThreadsPayload {
                        next_page_token: page.next_page_token,
                        priority_pass: false,
                        refresh_existing: p.refresh_existing,
                    },
                }),
            })
            .await
            .map_err(publish_error)?;
    } else {
        progress::finish_listing(&ctx.db, scope.job_id)
            .await
            .map_err(|e| map_db_error(e, "Failed to finish backfill listing"))?;
        // Also checks an empty final page, or threads that finished while the
        // listing was still publishing. The DB transition guards readiness.
        super::increment_counters::handle_job_completed(ctx, scope.job_id, None).await?;
    }
    Ok(())
}

fn publish_error(source: anyhow::Error) -> ProcessingError {
    ProcessingError::Retryable(DetailedError {
        reason: FailureReason::SqsEnqueueFailed,
        source: source.context("Failed to publish saved backfill page"),
    })
}

/// Lists the user's most recent sent messages and fans out one
/// [`BackfillOperation::SeedSentContact`] per message so the contacts service
/// gets seeded early in the backfill (see [`list_threads`]).
///
/// Best-effort by design. On any failure it logs and returns —
/// `handle_contacts_sync` re-seeds the full contact set at job completion.
#[cfg(feature = "contacts_sync")]
async fn enqueue_sent_contact_seeds(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<ListThreadsPayload>,
    link: &link::Link,
) {
    use models_email::email::service::backfill::SeedSentContactPayload;

    let message_ids = match ctx
        .email_api
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

        if let Err(e) = ctx.sqs_client.enqueue_email_backfill_message(msg).await {
            tracing::error!(error = ?e, link_id = %link.id, message_id = %message_provider_id, "Failed to enqueue sent-contact seed; skipping remaining");
            return;
        }
    }
}
