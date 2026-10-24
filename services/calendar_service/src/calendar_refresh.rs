//! Connection-gateway adapter that nudges calendar viewers after mutations.

use calendar_events::domain::ports::CalendarRefreshNotifier;
use connection_gateway_client::client::ConnectionGatewayClient;
use tracing::Instrument;
use uuid::Uuid;

use crate::pubsub_util::cg_refresh_calendar;

/// [`CalendarRefreshNotifier`] backed by the connection gateway: fans one
/// mutation's refresh nudge out to the link owner and its delegates, exactly
/// like the backfill-completion nudge, so open tabs refetch calendar
/// projections without waiting for a provider sync echo.
#[derive(Clone)]
pub struct ConnectionGatewayCalendarRefresh {
    client: ConnectionGatewayClient,
    db: sqlx::PgPool,
    team_sharing_enabled: bool,
}

impl ConnectionGatewayCalendarRefresh {
    /// Construct the adapter.
    pub fn new(
        client: ConnectionGatewayClient,
        db: sqlx::PgPool,
        team_sharing_enabled: bool,
    ) -> Self {
        Self {
            client,
            db,
            team_sharing_enabled,
        }
    }
}

impl CalendarRefreshNotifier for ConnectionGatewayCalendarRefresh {
    async fn calendar_changed(&self, owner_id: &str, email_link_id: Uuid, team_ooo_changed: bool) {
        // Spawned so the mutation response never waits on the gateway: the
        // client has no request timeout and the fan-out posts serially per
        // recipient, while the write this announces is already committed.
        let client = self.client.clone();
        let db = self.db.clone();
        let owner_id = owner_id.to_string();
        let team_sharing_enabled = self.team_sharing_enabled;
        tokio::spawn(
            async move {
                cg_refresh_calendar(
                    &client,
                    &db,
                    &owner_id,
                    email_link_id,
                    team_sharing_enabled,
                    team_ooo_changed,
                )
                .await;
            }
            .in_current_span(),
        );
    }

    async fn channel_access_lost(&self, user_ids: &[String], event_id: Uuid) {
        // Spawned like `calendar_changed`: the write is already committed.
        let client = self.client.clone();
        let user_ids = user_ids.to_vec();
        let span = tracing::info_span!(
            "calendar.notify_channel_access_lost",
            %event_id,
            recipients = user_ids.len(),
        );
        tokio::spawn(
            async move {
                let recipients: Vec<&str> = user_ids.iter().map(String::as_str).collect();
                if let Err(error) = client
                    .calendar_event_access_changed(&recipients, &event_id.to_string())
                    .await
                {
                    tracing::error!(error=?error, %event_id, "failed to tell channel members they lost a calendar event");
                }
            }
            .instrument(span),
        );
    }
}

impl calendar_events::domain::team::CalendarTeamNotifier for ConnectionGatewayCalendarRefresh {
    async fn sharing_changed(&self, user_id: &str) {
        let client = self.client.clone();
        let db = self.db.clone();
        let user_id = user_id.to_owned();
        tokio::spawn(
            async move {
                crate::pubsub_util::cg_refresh_team_calendar(&client, &db, &[user_id], true, true)
                    .await;
            }
            .in_current_span(),
        );
    }
}
