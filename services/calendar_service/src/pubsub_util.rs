//! Shared calendar pubsub helpers.

use connection_gateway_client::client::ConnectionGatewayClient;
use futures::{StreamExt, stream};

/// Signal every viewer of a connected inbox's calendars — the link owner
/// plus its delegated users — that the calendar projection changed. Best
/// effort: an inactive or unreachable viewer only misses a refresh nudge.
#[tracing::instrument(skip(client, db), level = "debug")]
pub async fn cg_refresh_calendar(
    client: &ConnectionGatewayClient,
    db: &sqlx::PgPool,
    owner_macro_id: &str,
    link_id: uuid::Uuid,
    team_sharing_enabled: bool,
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
    if team_sharing_enabled {
        cg_refresh_team_calendar(client, db, &recipients).await;
    }
    for macro_id in recipients {
        let _ = client
            .refresh_calendar(&macro_id, payload.clone())
            .await
            .inspect_err(
                |e| tracing::error!(macro_id = %macro_id, "Failed to refresh calendar: {e}"),
            );
    }
}

/// Invalidate teammate projections without exposing the underlying inbox IDs.
#[tracing::instrument(skip(client, db, shared_by))]
pub async fn cg_refresh_team_calendar(
    client: &ConnectionGatewayClient,
    db: &sqlx::PgPool,
    shared_by: &[String],
) {
    if !cfg!(feature = "connection_gateway") || shared_by.is_empty() {
        return;
    }
    let recipients = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT teammate.user_id
        FROM team_user membership
        JOIN team_user teammate ON teammate.team_id = membership.team_id
        WHERE membership.user_id = ANY($1::text[])
        UNION
        SELECT unnest($1::text[])
        "#,
        shared_by,
    )
    .fetch_all(db)
    .await;
    let recipients = match recipients {
        Ok(recipients) => recipients,
        Err(error) => {
            tracing::warn!(error=?error, "failed to resolve team calendar refresh recipients");
            return;
        }
    };
    let payload = serde_json::json!({"event": "team_sharing_changed"});
    stream::iter(recipients.into_iter().flatten())
        .for_each_concurrent(16, |user_id| {
            let payload = payload.clone();
            async move {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    client.refresh_calendar(&user_id, payload),
                ).await {
                    Ok(Ok(_)) => {},
                    Ok(Err(error)) => tracing::warn!(error=?error, "failed to invalidate a team calendar projection"),
                    Err(_) => tracing::warn!("team calendar invalidation timed out"),
                }
            }
        })
        .await;
}
