//! The concrete event broker service.

#[cfg(test)]
mod test;

use std::sync::Arc;
use std::time::Duration;

use macro_event_topics::Topic as _;
use tracing::Instrument as _;

use crate::domain::models::{EventBrokerError, MacroEvent};
use crate::domain::ports::{EventPublisher, MacroEventBroker};

const PUBLISH_TIMEOUT: Duration = Duration::from_secs(6);

/// Orchestrates serializing events and handing them to an [`EventPublisher`].
pub struct MacroEventBrokerService<P: EventPublisher> {
    publisher: Arc<P>,
}

impl<P: EventPublisher> Clone for MacroEventBrokerService<P> {
    fn clone(&self) -> Self {
        Self {
            publisher: Arc::clone(&self.publisher),
        }
    }
}

impl<P: EventPublisher> MacroEventBrokerService<P> {
    /// Create a new service backed by the given outbound publisher.
    pub fn new(publisher: P) -> Self {
        Self {
            publisher: Arc::new(publisher),
        }
    }
}

impl<P: EventPublisher> MacroEventBroker for MacroEventBrokerService<P> {
    #[tracing::instrument(err, skip(self, event), fields(topic = %event.topic().as_str(), key = %event.key()))]
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let topic = event.topic();
        let key = event.key().to_owned();
        let payload = serde_json::to_vec(event.event())?;
        let publisher = Arc::clone(&self.publisher);
        let span = tracing::Span::current();

        let handle = tokio::spawn(
            async move {
                tokio::time::timeout(PUBLISH_TIMEOUT, publisher.publish(topic, &key, &payload))
                    .await
                    .map_err(|_| EventBrokerError::PublishTimeout {
                        timeout: PUBLISH_TIMEOUT,
                    })
                    .and_then(std::convert::identity)
                    .inspect_err(|error| {
                        tracing::error!(
                            error = ?error,
                            topic = topic.as_str(),
                            key = %key,
                            "failed to publish event",
                        );
                    })
            }
            .instrument(span),
        );

        Ok(handle)
    }
}

/// A [`MacroEventBroker`] that drops every event.
///
/// Useful as a default type parameter for services that publish events
/// optionally, and in tests that don't care about published events.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopMacroEventBroker;

impl MacroEventBroker for NoopMacroEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        Ok(tokio::spawn(async { Ok(()) }))
    }
}
