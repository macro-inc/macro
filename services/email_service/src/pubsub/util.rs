use connection_gateway_client::client::ConnectionGatewayClient;
use email::domain::events::EmailMacroEvent;
use macro_event_broker::MacroEventBroker;
/// shared utils across different pubsub workers
use models_email::api::refresh::RefreshEmailEvent;

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
