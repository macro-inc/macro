//! Broker envelope and publication for verified GitHub App deliveries.

#[cfg(test)]
mod test;

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

    type PublicPayload = GithubWebhookPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, Exposure, PublicEntityType, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        match self {
            Self::Received(delivery) => {
                let installation_id = delivery.installation_id.to_string();
                // Delivery resolves the installation to the owners who may
                // see it (the routines claim rule), at fan-out time.
                Ok(Exposure::Public(PublicEvent {
                    name: "github_webhook.received",
                    entity: EntityRef::new(
                        PublicEntityType::GithubInstallation,
                        installation_id.clone(),
                    ),
                    audience: Audience::GithubInstallation { installation_id },
                    stage: Stage::Preview,
                    payload: Cow::Owned(GithubWebhookPublicEvent::Received(
                        GithubWebhookDelivery::from(delivery),
                    )),
                }))
            }
        }
    }
}

/// The public projection of [`GithubWebhookTopicEvent`]: what kind of
/// delivery arrived and for which repository. Never the raw payload or the
/// sender; read details from GitHub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum GithubWebhookPublicEvent {
    /// Macro's GitHub App received and verified a delivery.
    #[serde(rename = "github_webhook.received")]
    Received(GithubWebhookDelivery),
}

/// Public body of `github_webhook.received`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct GithubWebhookDelivery {
    /// The `X-GitHub-Event` header, such as `workflow_run`.
    pub event: String,
    /// The payload's `action`, such as `completed`; absent for events like `push`.
    pub action: Option<String>,
    /// The repository it is about, when it is about one.
    pub repository: Option<GithubWebhookDeliveryRepository>,
}

/// A repository in a public GitHub delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct GithubWebhookDeliveryRepository {
    /// GitHub's numeric repository id.
    pub id: u64,
    /// `owner/name` at the time of the delivery.
    pub full_name: String,
}

impl From<&GithubWebhookReceived> for GithubWebhookDelivery {
    fn from(delivery: &GithubWebhookReceived) -> Self {
        Self {
            event: delivery.event.clone(),
            action: delivery.action.clone(),
            repository: delivery.repository.as_ref().map(|repository| {
                GithubWebhookDeliveryRepository {
                    id: repository.id,
                    full_name: repository.full_name.clone(),
                }
            }),
        }
    }
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
