//! Shared calendar pubsub helpers.

use calendar_events::domain::models::RefreshCalendarEvent;
use connection_gateway_client::client::ConnectionGatewayClient;

#[cfg(test)]
mod test;

/// Signal every viewer of a connected inbox's calendars — the link owner
/// plus its delegated users — that the calendar projection changed, and,
/// with team sharing on, the teammates whose team views show those
/// calendars. One gateway request carries every refresh. Best effort: an
/// inactive or unreachable viewer only misses a refresh nudge.
#[tracing::instrument(
    skip(client, db, owner_macro_id),
    fields(viewers = tracing::field::Empty, teammates = tracing::field::Empty)
)]
pub async fn cg_refresh_calendar(
    client: &ConnectionGatewayClient,
    db: &sqlx::PgPool,
    owner_macro_id: &str,
    link_id: uuid::Uuid,
    team_sharing_enabled: bool,
    team_ooo_changed: bool,
) {
    if !cfg!(feature = "connection_gateway") {
        return;
    }
    let mut viewers = vec![owner_macro_id.to_string()];
    match sqlx::query_scalar!(
        "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
        link_id,
    )
    .fetch_all(db)
    .await
    {
        Ok(delegates) => viewers.extend(delegates),
        Err(error) => {
            tracing::warn!(error=?error, %link_id, "failed to resolve calendar refresh delegates");
        }
    }
    viewers.sort();
    viewers.dedup();
    // These viewers' own refresh below already refreshes their team views,
    // so only their teammates need the team refresh.
    let teammates = if team_sharing_enabled {
        teammates_to_refresh(db, &viewers, false).await
    } else {
        vec![]
    };
    let span = tracing::Span::current();
    span.record("viewers", count(viewers.len()));
    span.record("teammates", count(teammates.len()));
    let synced = event(RefreshCalendarEvent::Synced {
        link_id,
        team_ooo_changed,
    });
    let team = event(RefreshCalendarEvent::TeamSharingChanged { team_ooo_changed });
    let refreshes = viewers
        .into_iter()
        .map(|viewer| (viewer, synced.clone()))
        .chain(
            teammates
                .into_iter()
                .map(|teammate| (teammate, team.clone())),
        )
        .collect();
    let _ = client.refresh_calendars(refreshes).await.inspect_err(
        |error| tracing::error!(error=?error, %link_id, "failed to refresh calendar viewers"),
    );
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

/// Invalidate teammate projections without exposing the underlying inbox IDs
/// after `user_id` changed their sharing setting. The sharer is refreshed too,
/// since no inbox refresh reaches them with that change.
#[tracing::instrument(skip(client, db, user_id), fields(recipients = tracing::field::Empty))]
pub async fn cg_refresh_team_calendar(
    client: &ConnectionGatewayClient,
    db: &sqlx::PgPool,
    user_id: &str,
) {
    if !cfg!(feature = "connection_gateway") {
        return;
    }
    let recipients = teammates_to_refresh(db, &[user_id.to_owned()], true).await;
    tracing::Span::current().record("recipients", count(recipients.len()));
    let team = event(RefreshCalendarEvent::TeamSharingChanged {
        team_ooo_changed: true,
    });
    let _ = client
        .refresh_calendars(
            recipients
                .into_iter()
                .map(|recipient| (recipient, team.clone()))
                .collect(),
        )
        .await
        .inspect_err(
            |error| tracing::warn!(error=?error, "failed to invalidate team calendar projections"),
        );
}

fn event(event: RefreshCalendarEvent) -> serde_json::Value {
    serde_json::to_value(event).unwrap_or_default()
}

/// A span field count: unsigned values reach the collector as strings.
fn count(n: usize) -> i64 {
    i64::try_from(n).unwrap_or(i64::MAX)
}

/// The teammates whose team views show the calendars `shared_by` share. A
/// sharer whose setting is `none` shows teammates nothing, so their changes
/// refresh no teammate, but a sharing change reaches every teammate whatever
/// the new setting is, and the sharers too.
async fn teammates_to_refresh(
    db: &sqlx::PgPool,
    shared_by: &[String],
    sharing_changed: bool,
) -> Vec<String> {
    if shared_by.is_empty() {
        return vec![];
    }
    let found = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT teammate.user_id
        FROM team_user membership
        JOIN team_user teammate ON teammate.team_id = membership.team_id
        WHERE membership.user_id = ANY($1::text[])
          AND ($2 OR NOT EXISTS (
              SELECT 1 FROM calendar_team_sharing policy
              WHERE policy.user_id = membership.user_id AND policy.sharing = 'none'
          ))
        UNION
        SELECT unnest($1::text[])
        "#,
        shared_by,
        sharing_changed,
    )
    .fetch_all(db)
    .await;
    match found {
        Ok(found) => team_refresh_recipients(found, shared_by, sharing_changed),
        Err(error) => {
            tracing::warn!(error=?error, "failed to resolve team calendar refresh recipients");
            vec![]
        }
    }
}

/// The users a team refresh reaches, leaving out the sharers unless their
/// sharing changed.
fn team_refresh_recipients(
    found: Vec<Option<String>>,
    shared_by: &[String],
    sharing_changed: bool,
) -> Vec<String> {
    found
        .into_iter()
        .flatten()
        .filter(|user_id| sharing_changed || !shared_by.contains(user_id))
        .collect()
}
