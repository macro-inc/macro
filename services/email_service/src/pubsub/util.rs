use connection_gateway_client::client::ConnectionGatewayClient;
use email::domain::events::EmailMacroEvent;
use macro_event_broker::MacroEventBroker;
/// shared utils across different pubsub workers
use models_email::api::refresh::RefreshEmailEvent;
use std::time::Duration;

#[cfg(test)]
mod test;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

#[tracing::instrument(skip(tx, result), level = "debug")]
pub async fn complete_transaction_with_processing_error<T>(
    tx: sqlx::Transaction<'_, sqlx::Postgres>,
    result: Result<T, ProcessingError>,
) -> Result<T, ProcessingError> {
    match result {
        Ok(value) => {
            tx.commit().await.map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: anyhow::Error::from(e).context("Failed to commit transaction"),
                })
            })?;

            Ok(value)
        }
        Err(e) => match tx.rollback().await {
            Ok(_) => Err(e),
            Err(rollback_err) => {
                let combined_error = anyhow::anyhow!(
                    "Operation failed AND transaction rollback failed. Original error: {:?}, Rollback error: {:?}",
                    e,
                    rollback_err
                );

                Err(ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: combined_error,
                }))
            }
        },
    }
}

/// Publish an email event to the `macro.email` Kafka topic, logging and
/// dropping failures — event emission must never fail the email operation.
pub fn publish_email_event<B: MacroEventBroker>(broker: &B, event: &EmailMacroEvent) {
    let _ = broker
        .send_event(event)
        .inspect_err(|e| tracing::error!(error=?e, "failed to publish email macro event"));
}

/// Send message to connection gateway to trigger email refresh if user is active on FE
#[tracing::instrument(skip(client, macro_id), level = "debug")]
pub async fn cg_refresh_email(
    client: &ConnectionGatewayClient,
    macro_id: &str,
    event: RefreshEmailEvent,
) {
    if cfg!(feature = "connection_gateway") {
        let payload = serde_json::to_value(&event).unwrap_or_default();
        let _ = client
            .refresh_email(macro_id, payload)
            .await
            .inspect_err(|e| tracing::error!(error = %e, "Failed to refresh email"));
    }
}

/// The SQLSTATE of the first database failure in a worker error's chain, from
/// a `sqlx` error or a mailbox database failure, for the failure span's
/// `db.response.status_code`.
pub(crate) fn sqlstate(error: &anyhow::Error) -> Option<String> {
    use email::domain::mailbox::{DatabaseFailure, MailboxError};

    error.chain().find_map(|cause| {
        if let Some(error) = cause.downcast_ref::<sqlx::Error>() {
            return error
                .as_database_error()?
                .code()
                .map(|code| code.into_owned());
        }
        match cause.downcast_ref::<MailboxError>()? {
            MailboxError::Database(DatabaseFailure::Sqlstate(code))
            | MailboxError::Unstorable(code) => Some(code.clone()),
            _ => None,
        }
    })
}

/// How often a running operation pushes its message's visibility out again.
const VISIBILITY_HEARTBEAT: Duration = Duration::from_secs(20);
/// The backfill and CRM population queues' visibility timeout, restored by
/// every heartbeat.
const VISIBILITY_TIMEOUT_SECONDS: i32 = 60;
/// Longest wait for one heartbeat's answer. The SQS client sets no timeout of
/// its own, and a heartbeat that never answers must not hold the next one.
const HEARTBEAT_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Runs `work` while keeping its message hidden from other workers.
///
/// A whole thread, or any operation slowed by a struggling database, can
/// outlast the queue's visibility timeout. Delivered again while the first
/// copy still runs, the second copy would find the thread written and count
/// it, and the first would count it again through its metadata step,
/// completing the job early. A CRM population's message also holds its
/// mailbox's turn on the population queue. A failed heartbeat only logs: the
/// message then reappears as it would have without one.
pub(crate) async fn keep_invisible<F: Future>(
    message: &aws_sdk_sqs::types::Message,
    sqs_worker: &sqs_worker::SQSWorker,
    work: F,
) -> F::Output {
    let Some(receipt_handle) = message.receipt_handle() else {
        return work.await;
    };
    run_hidden(work, || {
        sqs_worker.change_message_visibility(receipt_handle, VISIBILITY_TIMEOUT_SECONDS)
    })
    .await
}

/// Runs `work` beside a heartbeat that hides its message again through
/// `extend`, so a slow heartbeat never holds the work up.
async fn run_hidden<F, E, R>(work: F, extend: E) -> F::Output
where
    F: Future,
    E: FnMut() -> R,
    R: Future<Output = anyhow::Result<()>>,
{
    tokio::select! {
        output = work => output,
        never = heartbeats(extend) => match never {},
    }
}

async fn heartbeats<E, R>(mut extend: E) -> std::convert::Infallible
where
    E: FnMut() -> R,
    R: Future<Output = anyhow::Result<()>>,
{
    let mut ticks = tokio::time::interval_at(
        tokio::time::Instant::now() + VISIBILITY_HEARTBEAT,
        VISIBILITY_HEARTBEAT,
    );
    loop {
        ticks.tick().await;
        match tokio::time::timeout(HEARTBEAT_REQUEST_TIMEOUT, extend()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::warn!(error = ?error, "failed to keep a running queue operation hidden");
            }
            Err(_) => tracing::warn!("timed out keeping a running queue operation hidden"),
        }
    }
}
