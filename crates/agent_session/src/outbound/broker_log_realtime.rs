//! [`AgentSessionRealtime`] that also publishes each appended run to the
//! event broker, so a process serving viewers of its own - the GraphQL
//! subscription in document storage - hears the frames too.

#[cfg(test)]
mod test;

use crate::domain::events::{AgentSessionLogMacroEvent, AgentSessionLogTopicEvent};
use crate::domain::model::{AgentSessionId, AgentSessionRenamed, LogAppended};
use crate::domain::ports::{AgentSessionQueueChanged, AgentSessionRealtime};
use macro_event_broker::MacroEventBroker;

/// `inner` keeps doing what it does; each run of frames is published to
/// `macro.agent_session_log` as well. The broker publish is best effort, as
/// the port allows: a refusal is logged and the inner result is returned.
#[derive(Debug, Clone)]
pub struct BrokerLogRealtime<Inner, Broker> {
    inner: Inner,
    broker: Broker,
}

impl<Inner, Broker> BrokerLogRealtime<Inner, Broker> {
    /// Publish through `inner`, and each log run through `broker` too.
    pub fn new(inner: Inner, broker: Broker) -> Self {
        Self { inner, broker }
    }
}

impl<Inner, Broker> AgentSessionRealtime for BrokerLogRealtime<Inner, Broker>
where
    Inner: AgentSessionRealtime + Sync,
    Broker: MacroEventBroker + Sync,
{
    async fn publish(&self, event: LogAppended) -> Result<(), rootcause::Report> {
        let session_id = event.agent_session_id;
        let macro_event = AgentSessionLogMacroEvent::new(AgentSessionLogTopicEvent::from(&event));
        let inner = self.inner.publish(event).await;
        let published = match self.broker.send_event(&macro_event) {
            Ok(handle) => match handle.await {
                Ok(result) => result.map_err(|error| error.to_string()),
                Err(join_error) => Err(join_error.to_string()),
            },
            Err(error) => Err(error.to_string()),
        };
        if let Err(error) = published {
            tracing::warn!(
                %error,
                %session_id,
                "failed to publish appended agent session log frames to the broker"
            );
        }
        inner
    }

    fn publish_updated(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send {
        self.inner.publish_updated(session)
    }

    fn publish_renamed(
        &self,
        event: AgentSessionRenamed,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send {
        self.inner.publish_renamed(event)
    }

    fn publish_queue_changed(
        &self,
        event: AgentSessionQueueChanged,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send {
        self.inner.publish_queue_changed(event)
    }

    fn publish_changes_updated(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send {
        self.inner.publish_changes_updated(session)
    }
}
