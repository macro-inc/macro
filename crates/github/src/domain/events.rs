//! Who receives verified GitHub App deliveries outside Macro, and in what
//! shape: the access of [`GithubWebhookTopicEvent`] and its public projection.

use crate::broker::GithubWebhookTopicEvent;
use crate::domain::models::GithubWebhookReceived;
use macro_event_broker::access::EventAccess;
use serde::Serialize;

impl EventAccess for GithubWebhookTopicEvent {
    type PublicPayload = GithubWebhookPublicEvent;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{
            Access, Audience, EntityRef, PublicEntityType, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        match self {
            Self::Received(delivery) => {
                let installation_id = delivery.installation_id.to_string();
                // Delivery resolves the installation to the owners who may
                // see it (the routines claim rule), at fan-out time.
                Ok(Access::Public(PublicEvent {
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
