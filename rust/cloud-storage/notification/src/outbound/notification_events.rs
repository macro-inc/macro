//! Postgres LISTEN adapter for notification database events.

use rootcause::Report;
use sqlx::postgres::PgListener;

use crate::domain::ports::NotificationEventsReceiver;

const CHANNEL: &str = "notification_events";

/// Postgres-backed receiver for notification events emitted with `pg_notify`.
pub struct PgNotificationEventsReceiver {
    database_url: String,
    listener: Option<PgListener>,
}

impl PgNotificationEventsReceiver {
    /// Create a new Postgres notification events receiver.
    pub fn new(database_url: String) -> Self {
        Self {
            database_url,
            listener: None,
        }
    }

    async fn listener(&mut self) -> Result<&mut PgListener, Report> {
        if self.listener.is_none() {
            let mut listener = PgListener::connect(&self.database_url).await?;
            listener.listen(CHANNEL).await?;
            tracing::info!(
                channel = CHANNEL,
                "listening for notification database events"
            );
            self.listener = Some(listener);
        }

        Ok(self
            .listener
            .as_mut()
            .expect("listener is initialized above"))
    }
}

impl NotificationEventsReceiver for PgNotificationEventsReceiver {
    async fn receive(&mut self) -> Result<String, Report> {
        match self.listener().await?.recv().await {
            Ok(notification) => Ok(notification.payload().to_string()),
            Err(err) => {
                self.listener = None;
                Err(err.into())
            }
        }
    }
}
