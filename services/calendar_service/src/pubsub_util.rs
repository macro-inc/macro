//! Shared calendar pubsub helpers.

use connection_gateway_client::client::ConnectionGatewayClient;

/// Signal every viewer of a connected inbox's calendars — the link owner
/// plus its delegated users — that the calendar projection changed. Best
/// effort: an inactive or unreachable viewer only misses a refresh nudge.
#[tracing::instrument(skip(client, db), level = "debug")]
pub async fn cg_refresh_calendar(
    client: &ConnectionGatewayClient,
    db: &sqlx::PgPool,
    owner_macro_id: &str,
    link_id: uuid::Uuid,
) {
    if !cfg!(feature = "connection_gateway") {
        return;
    }
    let payload = serde_json::to_value(
        calendar_events::domain::models::RefreshCalendarEvent::Synced { link_id },
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
            .inspect_err(
                |e| tracing::error!(macro_id = %macro_id, "Failed to refresh calendar: {e}"),
            );
    }
}
