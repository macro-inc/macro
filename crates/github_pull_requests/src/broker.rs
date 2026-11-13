//! Broker envelopes and publication for persisted pull request updates.

#[cfg(test)]
mod test;
use crate::domain::events::GithubPullRequestUpdated;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroGithubPullRequestsTopic;
use serde::{Deserialize, Serialize};

/// Facts published to the pull request topic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum GithubPullRequestTopicEvent {
    /// Stored PR metadata changed.
    #[serde(rename = "github_pull_request.updated")]
    Updated(GithubPullRequestUpdated),
}
/// Public payload of `github_pull_request.updated`: which pull request
/// changed. Its Macro records belong to different owners, so their ids stay
/// out; read the pull request by key for the new state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct PublicGithubPullRequestUpdated {
    /// The pull request's lowercased `owner/repo/pull/number` key.
    pub github_key: String,
}

/// The public projection of [`GithubPullRequestTopicEvent`], delivered under
/// the same event names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum GithubPullRequestPublicEvent {
    /// Stored pull request metadata changed.
    #[serde(rename = "github_pull_request.updated")]
    Updated(PublicGithubPullRequestUpdated),
}

impl TopicEvent for GithubPullRequestTopicEvent {
    type Topic = MacroGithubPullRequestsTopic;
    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = GithubPullRequestPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, EntityType, Exposure, PublicEntityType, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        match self {
            // Whoever can see any Macro record of the pull request.
            Self::Updated(update) => {
                if update.foreign_entity_ids.is_empty() {
                    return Ok(Exposure::internal_by_design(
                        "a pull request update that touched no Macro record has no audience",
                    ));
                }
                let github_key = update.github_key.to_lowercase();
                Ok(Exposure::Public(PublicEvent {
                    name: "github_pull_request.updated",
                    entity: EntityRef::new(PublicEntityType::GithubPullRequest, github_key.clone()),
                    audience: Audience::Any(
                        update
                            .foreign_entity_ids
                            .iter()
                            .map(|id| Audience::Entity {
                                entity_type: EntityType::ForeignEntity,
                                entity_id: id.to_string(),
                            })
                            .collect(),
                    ),
                    stage: Stage::Preview,
                    payload: Cow::Owned(GithubPullRequestPublicEvent::Updated(
                        PublicGithubPullRequestUpdated { github_key },
                    )),
                }))
            }
        }
    }
}
/// An event keyed by PR so updates retain per-PR ordering.
#[derive(Debug, Clone)]
pub struct GithubPullRequestMacroEvent {
    key: String,
    event: Event<GithubPullRequestTopicEvent>,
}
impl GithubPullRequestMacroEvent {
    /// Wrap a committed PR change.
    pub fn updated(update: GithubPullRequestUpdated) -> Self {
        Self {
            key: update.github_key.to_lowercase(),
            event: Event::new(GithubPullRequestTopicEvent::Updated(update)),
        }
    }
}
impl MacroEvent for GithubPullRequestMacroEvent {
    type EventPayload = GithubPullRequestTopicEvent;
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
/// Publishes PR facts through the shared event broker.
pub struct BrokerGithubPullRequestPublisher<B>(pub B);
#[cfg(feature = "ports")]
impl<B: macro_event_broker::MacroEventBroker> crate::domain::ports::GithubPullRequestEventPublisher
    for BrokerGithubPullRequestPublisher<B>
{
    fn publish_updated(
        &self,
        update: GithubPullRequestUpdated,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<(), rootcause::Report>> + Send + '_>,
    > {
        Box::pin(async move {
            use rootcause::prelude::ResultExt as _;
            self.0
                .send_event(&GithubPullRequestMacroEvent::updated(update))
                .context("enqueueing PR update")?
                .await
                .context("joining PR publication")?
                .context("publishing PR update")?;
            Ok(())
        })
    }
}
