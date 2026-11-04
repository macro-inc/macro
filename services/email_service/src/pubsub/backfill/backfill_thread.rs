use crate::backfill_completion_service::{
    completion_effect_retry, enqueue_thread_metadata_update, handle_thread_attachment_upload,
};
use crate::pubsub::backfill::backfill_message::{enqueue_crm_contacts, save_invitations};
use crate::pubsub::backfill::db_error::{is_unstorable, map_db_error};
use crate::pubsub::backfill::email_api_error::map_email_api_error;
use crate::pubsub::backfill::increment_counters::incr_completed_threads;
use crate::pubsub::backfill::write_slot;
use crate::pubsub::context::PubSubContext;
use crate::util::process_pre_insert::process_message_pre_insert;
use email_db_client::backfill::progress::import;
use models_email::service::backfill::{BackfillThreadPayload, JobScopedPayload};
use models_email::service::link::Link;
use models_email::service::pubsub::ProcessingError;

/// Import one provider snapshot, then resume required effects until metadata
/// records completion. The import receipt commits with the messages, so neither
/// a retry nor a concurrent delivery can write a later snapshot after completion.
#[tracing::instrument(skip(ctx, scope, link), fields(job_id = %scope.job_id, thread_provider_id = %scope.payload.thread_provider_id, message_count), err)]
pub async fn backfill_thread(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<BackfillThreadPayload>,
    link: &Link,
) -> Result<(), ProcessingError> {
    let provider_id = &scope.payload.thread_provider_id;
    let receipt = import::receipt(&ctx.db, scope.job_id, provider_id)
        .await
        .map_err(|e| map_db_error(e, "Failed to read backfill import receipt"))?;
    if receipt.completed || receipt.provider_missing {
        return incr_completed_threads(ctx, link, scope.job_id, provider_id).await;
    }
    let thread_id = match receipt.thread_id {
        Some(id) => id,
        None => {
            let fetched = match ctx.email_api.get_thread(link.id, provider_id).await {
                Ok(fetched) => fetched,
                Err(email_api_client::domain::models::EmailApiError::NotFound) => {
                    let receipt = import::mark_provider_missing(&ctx.db, scope.job_id, provider_id)
                        .await
                        .map_err(|e| map_db_error(e, "Failed to record provider-deleted thread"))?;
                    if let Some(thread_id) = receipt.thread_id {
                        return finish_import(ctx, scope, link, thread_id).await;
                    }
                    return incr_completed_threads(ctx, link, scope.job_id, provider_id).await;
                }
                Err(error) => {
                    return Err(map_email_api_error(error, "Failed to get provider thread"));
                }
            };
            tracing::Span::current().record("message_count", fetched.len() as i64);
            let mut messages = Vec::with_capacity(fetched.len());
            let mut calendar_parts = Vec::with_capacity(fetched.len());
            for item in fetched {
                let mut message = item.message;
                process_message_pre_insert(&mut message).await;
                messages.push(message);
                calendar_parts.push(item.calendar_parts);
            }
            let slot = write_slot::acquire(ctx).await?;
            let imported = slot
                .hold(async {
                    // Publish for ALL provider messages, including already-stored
                    // ones from a legacy job whose earlier follow-up was interrupted.
                    for message in &messages {
                        enqueue_crm_contacts(ctx, link, message).await?;
                    }
                    import::write_thread(
                        &ctx.db,
                        scope.job_id,
                        provider_id,
                        link.id,
                        &mut messages,
                        is_unstorable,
                    )
                    .await
                    .map_err(|e| map_db_error(e, "Failed to commit backfill import receipt"))
                })
                .await?;
            let import::ImportOutcome::Stored(imported) = imported else {
                return incr_completed_threads(ctx, link, scope.job_id, provider_id).await;
            };
            if imported.written {
                for skipped in &imported.skipped {
                    tracing::warn!(error = ?skipped.error, index = skipped.index as i64, "Skipped an unstorable backfill message");
                }
                for (index, (message, parts)) in messages.iter().zip(&calendar_parts).enumerate() {
                    if !imported
                        .skipped
                        .iter()
                        .any(|skipped| skipped.index == index)
                    {
                        // Invitation extraction retains its existing best-effort policy.
                        save_invitations(ctx, link, message, parts).await;
                    }
                }
            }
            imported.thread_id
        }
    };
    finish_import(ctx, scope, link, thread_id).await
}

async fn finish_import(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<BackfillThreadPayload>,
    link: &Link,
    thread_id: uuid::Uuid,
) -> Result<(), ProcessingError> {
    handle_thread_attachment_upload(ctx, link, scope.job_id, thread_id)
        .await
        .map_err(completion_effect_retry)?;
    enqueue_thread_metadata_update(
        ctx,
        link,
        scope.job_id,
        &scope.payload.thread_provider_id,
        thread_id,
    )
    .await
}
