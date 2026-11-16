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

/// Signal every viewer of a connected inbox's calendars — the link owner
/// plus its delegated users — that the calendar projection changed. Best
/// effort: an inactive or unreachable viewer only misses a refresh nudge.
#[tracing::instrument(skip(client, db, owner_macro_id), level = "debug")]
pub async fn cg_refresh_calendar(
    client: &ConnectionGatewayClient,
    db: &sqlx::PgPool,
    owner_macro_id: &str,
    link_id: uuid::Uuid,
    team_ooo_changed: bool,
) {
    if !cfg!(feature = "connection_gateway") {
        return;
    }
    let payload = serde_json::to_value(
        calendar_events::domain::models::RefreshCalendarEvent::Synced {
            link_id,
            team_ooo_changed,
        },
    )
    .unwrap_or_default();
    let mut recipients = vec![owner_macro_id.to_string()];
    match sqlx::query_scalar!(
        "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
        link_id,
    )
    .fetch_all(db)
    .await
    {
        Ok(delegates) => recipients.extend(delegates),
        Err(error) => {
            tracing::warn!(error=?error, %link_id, "failed to resolve calendar refresh delegates");
        }
    }
    recipients.sort();
    recipients.dedup();
    for macro_id in recipients {
        let _ = client
            .refresh_calendar(&macro_id, payload.clone())
            .await
            .inspect_err(|e| tracing::error!(error = %e, %link_id, "Failed to refresh calendar"));
    }
}

/// Tell one requester their request to join `event_id` was answered. It names
/// the event, whose id they hold, and not the sharer's inbox.
#[tracing::instrument(skip(client, requester_id), level = "debug")]
pub async fn cg_refresh_join_request(
    client: &ConnectionGatewayClient,
    requester_id: &str,
    event_id: uuid::Uuid,
) {
    if !cfg!(feature = "connection_gateway") {
        return;
    }
    let payload = serde_json::to_value(
        calendar_events::domain::models::RefreshCalendarEvent::JoinRequestAnswered { event_id },
    )
    .unwrap_or_default();
    let _ = client
        .refresh_calendar(requester_id, payload)
        .await
        .inspect_err(
            |e| tracing::error!(%event_id, "Failed to refresh the requester's calendar: {e}"),
        );
}
