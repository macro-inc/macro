//! Connection-gateway adapter that nudges calendar viewers after mutations.

use calendar_events::domain::ports::CalendarRefreshNotifier;
use connection_gateway_client::client::ConnectionGatewayClient;
use uuid::Uuid;

use crate::pubsub::util::cg_refresh_calendar;

/// [`CalendarRefreshNotifier`] backed by the connection gateway: fans one
/// mutation's refresh nudge out to the link owner and its delegates, exactly
/// like the backfill-completion nudge, so open tabs refetch calendar
/// projections without waiting for a provider sync echo.
#[derive(Clone)]
pub struct ConnectionGatewayCalendarRefresh {
    client: ConnectionGatewayClient,
    db: sqlx::PgPool,
}

impl ConnectionGatewayCalendarRefresh {
    /// Construct the adapter.
    pub fn new(client: ConnectionGatewayClient, db: sqlx::PgPool) -> Self {
        Self { client, db }
    }
}

impl CalendarRefreshNotifier for ConnectionGatewayCalendarRefresh {
    async fn calendar_changed(&self, owner_id: &str, email_link_id: Uuid) {
        // Spawned so the mutation response never waits on the gateway: the
        // client has no request timeout and the fan-out posts serially per
        // recipient, while the write this announces is already committed.
        let client = self.client.clone();
        let db = self.db.clone();
        let owner_id = owner_id.to_string();
        tokio::spawn(async move {
            cg_refresh_calendar(&client, &db, &owner_id, email_link_id).await;
        });
    }
}
