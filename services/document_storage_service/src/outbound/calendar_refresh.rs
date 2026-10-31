//! Connection-gateway adapter that nudges calendar viewers from this service,
//! which hosts asking to join a shared event.

use calendar_events::domain::{models::RefreshCalendarEvent, ports::CalendarRefreshNotifier};
use connection_gateway_client::client::ConnectionGatewayClient;
use sqlx::PgPool;
use tokio_util::task::TaskTracker;
use tracing::Instrument;
use uuid::Uuid;

#[cfg(test)]
mod test;

const REFRESHED: &str = "refreshed";

/// [`CalendarRefreshNotifier`] backed by the connection gateway: fans one
/// nudge out to the link owner and its delegates, as `calendar_service` and
/// `email_service` do. Nothing written here changes a team's view, so unlike
/// `calendar_service` it sends teammates no team refresh.
#[derive(Clone)]
pub struct ConnectionGatewayCalendarRefresh {
    client: ConnectionGatewayClient,
    db: PgPool,
    tasks: TaskTracker,
}

impl ConnectionGatewayCalendarRefresh {
    /// Construct the adapter. `tasks` is drained at shutdown, so a nudge for a
    /// committed write still goes out when the service stops right after it.
    pub fn new(client: ConnectionGatewayClient, db: PgPool, tasks: TaskTracker) -> Self {
        Self { client, db, tasks }
    }

    /// Signal the viewers of `link_id`. Delegates are found by the link
    /// alone, as `get_event_mutation_target` admits them to the request list:
    /// a promoted shared mailbox's edges name the mailbox as their child, not
    /// the owner its older events carry. Best effort: a viewer it misses only
    /// misses a refresh.
    #[tracing::instrument(
        name = "calendar.refresh_inbox_viewers",
        skip_all,
        fields(
            link_id = %link_id,
            recipients = tracing::field::Empty,
            failed_sends = tracing::field::Empty,
            outcome = tracing::field::Empty,
        )
    )]
    async fn refresh_inbox_viewers(&self, owner_id: &str, link_id: Uuid, team_ooo_changed: bool) {
        if !cfg!(feature = "connection_gateway") {
            return;
        }
        let payload = serde_json::to_value(RefreshCalendarEvent::Synced {
            link_id,
            team_ooo_changed,
        })
        .unwrap_or_default();
        let mut recipients = vec![owner_id.to_string()];
        let mut delegates_resolved = true;
        match sqlx::query_scalar!(
            "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
            link_id,
        )
        .fetch_all(&self.db)
        .await
        {
            Ok(delegates) => recipients.extend(delegates),
            Err(error) => {
                delegates_resolved = false;
                tracing::warn!(error=?error, %link_id, "failed to resolve calendar refresh delegates");
            }
        }
        recipients.sort();
        recipients.dedup();
        let span = tracing::Span::current();
        span.record("recipients", recipients.len());
        let mut failed_sends = 0_usize;
        for macro_id in recipients {
            let sent = self
                .client
                .refresh_calendar(&macro_id, payload.clone())
                .await
                .inspect_err(
                    |error| tracing::error!(error=?error, %link_id, "failed to refresh calendar"),
                );
            failed_sends += usize::from(sent.is_err());
        }
        span.record("failed_sends", failed_sends);
        span.record(
            "outcome",
            if delegates_resolved && failed_sends == 0 {
                REFRESHED
            } else {
                "partial"
            },
        );
    }

    /// Tell one requester their request to join `event_id` was answered. It
    /// names the event, whose id they hold, and not the sharer's inbox.
    #[tracing::instrument(
        name = "calendar.refresh_join_requester",
        skip_all,
        fields(event_id = %event_id, outcome = tracing::field::Empty)
    )]
    async fn refresh_requester(&self, requester_id: &str, event_id: Uuid) {
        if !cfg!(feature = "connection_gateway") {
            return;
        }
        let payload = serde_json::to_value(RefreshCalendarEvent::JoinRequestAnswered { event_id })
            .unwrap_or_default();
        let sent = self
            .client
            .refresh_calendar(requester_id, payload)
            .await
            .inspect_err(|error| {
                tracing::error!(error=?error, %event_id, "failed to refresh the requester's calendar");
            });
        tracing::Span::current().record("outcome", if sent.is_ok() { REFRESHED } else { "failed" });
    }
}

impl CalendarRefreshNotifier for ConnectionGatewayCalendarRefresh {
    async fn calendar_changed(&self, owner_id: &str, email_link_id: Uuid, team_ooo_changed: bool) {
        // Spawned so the response never waits on the gateway, which is posted
        // to serially per recipient, while the write is already committed.
        let refresh = self.clone();
        let owner_id = owner_id.to_string();
        self.tasks.spawn(
            async move {
                refresh
                    .refresh_inbox_viewers(&owner_id, email_link_id, team_ooo_changed)
                    .await;
            }
            .in_current_span(),
        );
    }

    async fn join_request_answered(&self, requester_id: &str, event_id: Uuid) {
        let refresh = self.clone();
        let requester_id = requester_id.to_string();
        self.tasks.spawn(
            async move {
                refresh.refresh_requester(&requester_id, event_id).await;
            }
            .in_current_span(),
        );
    }
}
