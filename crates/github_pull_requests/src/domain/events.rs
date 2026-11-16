//! Facts emitted after a pull request has been stored.
use crate::broker::GithubPullRequestTopicEvent;
use macro_event_broker::access::EventAccess;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A persisted update to a pull request and its source-scoped entity records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GithubPullRequestUpdated {
    /// The canonical `owner/repo/pull/number` key used by session links.
    pub github_key: String,
    /// Exact foreign entity identities affected by this write.
    pub foreign_entity_ids: Vec<Uuid>,
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

impl EventAccess for GithubPullRequestTopicEvent {
    type PublicPayload = GithubPullRequestPublicEvent;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{
            Access, Audience, EntityRef, EntityType, PublicEntityType, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        match self {
            // Whoever can see any Macro record of the pull request.
            Self::Updated(update) => {
                if update.foreign_entity_ids.is_empty() {
                    return Ok(Access::Internal {
                        reason: "a pull request update that touched no Macro record has no audience",
                    });
                }
                let github_key = update.github_key.to_lowercase();
                Ok(Access::Public(PublicEvent {
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
