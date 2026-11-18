use super::*;
use crate::domain::events::{EmailMacroEvent, ThreadBackfilledMetadata};
use crate::domain::mailbox::connection::ConnectionSourceError;
use macro_event_broker::MacroEventBroker;
use models_email::service::{
    backfill::*,
    link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};

/// This step is invoked by BackfillMessage once all messages in a thread have been backfilled.
/// Updates the thread metadata in the database, the replying_to_id values of its messages, and
/// notifies dependencies of a new thread being backfilled. If it's the last thread to be processed,
/// it sets the backfill job status to complete.
#[tracing::instrument(skip(ctx))]
pub(super) async fn update_thread_metadata<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    scope: &JobScopedPayload<UpdateMetadataPayload>,
    link: &link::Link,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let p = &scope.payload;
    let mut tx = ctx.repository.begin_metadata().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e
                .into_original()
                .context("Failed to create transaction for update metadata"),
        })
    })?;
    let result = async {
        tx.update_metadata(p.thread_db_id, link.id)
            .await
            .map_err(|e| map_db_error(e, "Failed to update thread metadata"))?;
        tx.update_replying_to(p.thread_db_id, link.id)
            .await
            .map_err(|e| map_db_error(e, "Failed to update message replying to id"))?;
        Ok(())
    }
    .await;
    tx.complete(result).await?;

    super::counters::incr_completed_threads(ctx, link, scope.job_id).await?;

    // Best-effort by design: publication failures are logged and dropped so a committed
    // backfill is not retried after its completed-thread counters have advanced.
    publish_email_event(
        &ctx.effects,
        &EmailMacroEvent::thread_backfilled(ThreadBackfilledMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            thread_id: p.thread_db_id,
        }),
    );

    Ok(())
}

fn publish_email_event<B: MacroEventBroker>(broker: &B, event: &EmailMacroEvent) {
    let _ = broker
        .send_event(event)
        .inspect_err(|e| tracing::error!(error=?e, "failed to publish email macro event"));
}

/// Classify a database failure while preserving its original context chain.
pub fn map_db_error<C: std::fmt::Display + Send + Sync + 'static>(
    error: BackfillDatabaseError,
    context: C,
) -> ProcessingError {
    match error
        .sqlstates
        .iter()
        .find(|code| is_unstorable_sqlstate(code))
    {
        Some(sqlstate) => ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::InvalidData,
            source: error
                .source
                .context(format!("{context} (deterministic SQLSTATE {sqlstate})")),
        }),
        None => ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: error.source.context(context),
        }),
    }
}

/// Whether a SQLSTATE represents input that redelivery cannot store.
pub fn is_unstorable_sqlstate(code: &str) -> bool {
    code.starts_with("22") || matches!(code, "23502" | "23514")
}
