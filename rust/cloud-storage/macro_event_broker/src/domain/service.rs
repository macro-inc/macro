//! The concrete event broker service.

#[cfg(test)]
mod test;

use macro_event_topics::Topic as _;

use crate::domain::models::{EventBrokerError, MacroEvent};
use crate::domain::ports::{EventPublisher, MacroEventBroker};

/// Orchestrates serializing events and handing them to an [`EventPublisher`].
pub struct MacroEventBrokerService<P: EventPublisher> {
    publisher: P,
}

impl<P: EventPublisher> MacroEventBrokerService<P> {
    /// Create a new service backed by the given outbound publisher.
    pub fn new(publisher: P) -> Self {
        Self { publisher }
    }
}

impl<P: EventPublisher> MacroEventBroker for MacroEventBrokerService<P> {
    #[tracing::instrument(err, skip(self, event), fields(topic = %event.topic().as_str(), key = %event.key()))]
    async fn send_event<E: MacroEvent + ?Sized>(&self, event: &E) -> Result<(), EventBrokerError> {
        let topic = event.topic();
        let key = event.key();
        let envelope = event.event();
        let payload = serde_json::to_vec(envelope)?;

        self.publisher.publish(topic, key, &payload).await
    }
}
