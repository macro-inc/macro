//! Broker envelope and publication for verified GitHub App deliveries.

use crate::domain::models::GithubWebhookReceived;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroGithubWebhooksTopic;
use serde::{Deserialize, Serialize};

/// Facts published to `macro.github_webhooks`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum GithubWebhookTopicEvent {
    /// The GitHub App received and verified a delivery.
    #[serde(rename = "github_webhook.received")]
    Received(GithubWebhookReceived),
}

impl TopicEvent for GithubWebhookTopicEvent {
    type Topic = MacroGithubWebhooksTopic;
    const SCHEMA_VERSION: u8 = 1;
}

/// A delivery keyed by installation, so one installation's deliveries keep
/// their order.
#[derive(Debug, Clone)]
pub struct GithubWebhookMacroEvent {
    key: String,
    event: Event<GithubWebhookTopicEvent>,
}

impl GithubWebhookMacroEvent {
    /// Wrap a verified delivery.
    pub fn received(delivery: GithubWebhookReceived) -> Self {
        Self {
            key: delivery.installation_id.to_string(),
            event: Event::new(GithubWebhookTopicEvent::Received(delivery)),
        }
    }
}

impl MacroEvent for GithubWebhookMacroEvent {
    type EventPayload = GithubWebhookTopicEvent;
    fn key(&self) -> &str {
        &self.key
    }
    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }
    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

/// Publishes deliveries through the shared event broker.
#[cfg(feature = "sync")]
pub struct BrokerGithubWebhookPublisher<B>(pub B);

#[cfg(feature = "sync")]
impl<B: macro_event_broker::MacroEventBroker> crate::domain::ports::GithubWebhookPublisher
    for BrokerGithubWebhookPublisher<B>
{
    fn publish_received(
        &self,
        delivery: GithubWebhookReceived,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<(), crate::domain::models::GithubError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            self.0
                .send_event(&GithubWebhookMacroEvent::received(delivery))
                .map_err(anyhow::Error::from)?
                .await
                .map_err(anyhow::Error::from)?
                .map_err(anyhow::Error::from)?;
            Ok(())
        })
    }
}
