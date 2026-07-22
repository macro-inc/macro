//! Macro event broker publisher for realtime Soup events.

#[cfg(test)]
mod test;

use macro_event_broker::MacroEventBroker;
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::{
    models::{SoupMacroEvent, SoupRealtimeMessage},
    ports::SoupRealtimePublisher,
};

/// Realtime Soup publisher backed by the typed macro event broker service.
pub struct KafkaSoupRealtimePublisher<B> {
    broker: B,
}

impl<B> KafkaSoupRealtimePublisher<B> {
    /// Creates a realtime Soup publisher from a macro event broker service.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B> SoupRealtimePublisher for KafkaSoupRealtimePublisher<B>
where
    B: MacroEventBroker,
{
    #[tracing::instrument(
        skip(self, message),
        fields(user_id = %message.user_id),
        err
    )]
    async fn publish(&self, message: SoupRealtimeMessage) -> Result<(), Report> {
        let event = SoupMacroEvent::item_updated(message);
        let publish = self
            .broker
            .send_event(&event)
            .context("failed to dispatch realtime Soup event")?;

        publish
            .await
            .context("realtime Soup publish task failed")?
            .context("failed to publish realtime Soup event")?;

        Ok(())
    }
}
