//! [`AgentSessionLifecyclePublisher`] over the Macro event broker.

#[cfg(test)]
mod test;

use std::pin::Pin;

use crate::domain::events::{AgentSessionLifecycleEvent, AgentSessionLifecycleMacroEvent};
use macro_event_broker::MacroEventBroker;

use crate::domain::ports::AgentSessionLifecyclePublisher;

/// Publishes each fact to `macro.agent_session_lifecycle`, keyed by session
/// id, and waits for the broker to accept it.
///
/// Waiting - rather than fire-and-forget - is what lets the caller's span
/// show a publish that failed. The result is still only logged: nothing about
/// the session went wrong.
#[derive(Debug, Clone)]
pub struct BrokerLifecyclePublisher<Broker> {
    broker: Broker,
}

impl<Broker> BrokerLifecyclePublisher<Broker> {
    /// Publish through `broker`.
    pub fn new(broker: Broker) -> Self {
        Self { broker }
    }
}

impl<Broker> AgentSessionLifecyclePublisher for BrokerLifecyclePublisher<Broker>
where
    Broker: MacroEventBroker,
{
    fn publish(
        &self,
        event: AgentSessionLifecycleEvent,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let event_type = event.name();
            let session_id = event.session_id();
            let macro_event = AgentSessionLifecycleMacroEvent::new(event);
            let published = match self.broker.send_event(&macro_event) {
                Ok(handle) => match handle.await {
                    Ok(result) => result.map_err(|error| error.to_string()),
                    Err(join_error) => Err(join_error.to_string()),
                },
                Err(error) => Err(error.to_string()),
            };
            match published {
                Ok(()) => tracing::debug!(
                    %session_id,
                    macro.event.type = event_type,
                    "published agent session lifecycle event"
                ),
                Err(error) => tracing::warn!(
                    %error,
                    %session_id,
                    macro.event.type = event_type,
                    "failed to publish agent session lifecycle event"
                ),
            }
        })
    }
}
