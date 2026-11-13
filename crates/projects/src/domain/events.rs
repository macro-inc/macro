//! Kafka event models for the `macro.projects` topic.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroProjectsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use serde::{Deserialize, Serialize};

/// Metadata for [`ProjectTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectCreatedMetadata {
    /// The id of the created project.
    pub project_id: String,
    /// The owner and creator of the project.
    pub owner: Owner,
    /// The project name.
    pub name: String,
    /// The parent project id, when the project has a parent.
    pub parent_project_id: Option<String>,
    /// The creation timestamp reported by the repository.
    pub created_at: Option<DateTime<Utc>>,
}

/// Metadata for [`ProjectTopicEvent::Updated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectUpdatedMetadata {
    /// The id of the updated project.
    pub project_id: String,
    /// The owner of the project.
    pub owner: Owner,
    /// The authenticated user who performed the update, if any.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// The new project name, or `None` when unchanged.
    pub name: Option<String>,
    /// The parent project id before the update.
    pub previous_parent_id: Option<String>,
    /// The requested parent project id; `None` means unchanged and `Some("")` means root.
    pub parent_id: Option<String>,
    /// Whether share permissions were updated.
    pub share_permission_updated: bool,
}

/// Metadata for [`ProjectTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectDeletedMetadata {
    /// The id of the root project that was deleted.
    pub project_id: String,
    /// The owner of the root project.
    pub owner: Owner,
    /// The authenticated user who performed the deletion, if any.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// The parent of the root project, when any.
    pub parent_project_id: Option<String>,
    /// The ids of all projects deleted in the cascade.
    pub deleted_project_ids: Vec<String>,
    /// The ids of all documents deleted in the cascade.
    pub deleted_document_ids: Vec<String>,
    /// The ids of all chats deleted in the cascade.
    pub deleted_chat_ids: Vec<String>,
}

/// Metadata for [`ProjectTopicEvent::Restored`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRestoredMetadata {
    /// The id of the root project that was restored.
    pub project_id: String,
    /// The owner of the root project.
    pub owner: Owner,
    /// The authenticated user who performed the restoration, if any.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// The parent under which the root project was restored, when any.
    pub parent_project_id: Option<String>,
    /// The ids of all projects restored in the cascade.
    pub restored_project_ids: Vec<String>,
}

/// Metadata for [`ProjectTopicEvent::PermanentlyDeleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectPermanentlyDeletedMetadata {
    /// The id of the root project that was permanently deleted.
    pub project_id: String,
    /// The owner of the root project.
    pub owner: Owner,
    /// The authenticated user who performed the deletion, if any.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// The parent of the root project, when any.
    pub parent_project_id: Option<String>,
    /// The ids of all projects purged in the cascade.
    pub purged_project_ids: Vec<String>,
    /// The ids of all documents purged in the cascade.
    pub purged_document_ids: Vec<String>,
    /// The ids of all chats purged in the cascade.
    pub purged_chat_ids: Vec<String>,
}

/// Metadata for [`ProjectTopicEvent::Uploaded`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectUploadedMetadata {
    /// The id of the root project in the uploaded tree.
    pub root_project_id: String,
    /// The owner of the uploaded tree.
    pub owner: Owner,
    /// The name of the root project.
    pub name: String,
    /// The parent of the root project, when any.
    pub parent_project_id: Option<String>,
    /// The ids of all projects made live in the uploaded tree.
    pub project_ids: Vec<String>,
}

/// Events that can be published to [`MacroProjectsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum ProjectTopicEvent {
    /// A project was created.
    #[serde(rename = "project.created")]
    Created(ProjectCreatedMetadata),
    /// A project's metadata or permissions were updated.
    #[serde(rename = "project.updated")]
    Updated(ProjectUpdatedMetadata),
    /// A project tree was soft-deleted.
    #[serde(rename = "project.deleted")]
    Deleted(ProjectDeletedMetadata),
    /// A project tree was restored.
    #[serde(rename = "project.restored")]
    Restored(ProjectRestoredMetadata),
    /// A project tree was permanently deleted.
    #[serde(rename = "project.permanently_deleted")]
    PermanentlyDeleted(ProjectPermanentlyDeletedMetadata),
    /// An uploaded project tree was made live.
    #[serde(rename = "project.uploaded")]
    Uploaded(ProjectUploadedMetadata),
}

/// What a [`ProjectTopicEvent::Updated`] changed, without the new values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ProjectChange {
    /// The project was renamed.
    Name,
    /// The project moved under another parent, or to the root.
    Parent,
    /// Who the project is shared with changed.
    Sharing,
}

/// Public payload of `project.created`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PublicProjectCreated {
    /// The created project.
    pub project_id: String,
    /// Its parent project, when it has one.
    pub parent_project_id: Option<String>,
    /// Creation time reported by the repository.
    pub created_at: Option<DateTime<Utc>>,
}

/// Public payload of `project.updated`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PublicProjectUpdated {
    /// The updated project.
    pub project_id: String,
    /// The authenticated user who updated it, if any.
    #[cfg_attr(feature = "axum", schema(value_type = Option<String>))]
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// What changed; read the project for the new values.
    pub changes: Vec<ProjectChange>,
}

/// Public payload of `project.deleted`, `project.restored`,
/// `project.permanently_deleted` and `project.uploaded`: the root project of
/// the tree. Child ids are left out; each child is read, or emits, on its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PublicProjectTree {
    /// The root project of the affected tree.
    pub project_id: String,
    /// The root project's parent, when it has one.
    pub parent_project_id: Option<String>,
    /// The authenticated user who acted, if any.
    #[cfg_attr(feature = "axum", schema(value_type = Option<String>))]
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
}

/// The public projection of [`ProjectTopicEvent`], delivered under the same
/// event names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum ProjectPublicEvent {
    /// A project was created.
    #[serde(rename = "project.created")]
    Created(PublicProjectCreated),
    /// A project's name, parent or sharing changed.
    #[serde(rename = "project.updated")]
    Updated(PublicProjectUpdated),
    /// A project tree was moved to the trash.
    #[serde(rename = "project.deleted")]
    Deleted(PublicProjectTree),
    /// A project tree was restored from the trash.
    #[serde(rename = "project.restored")]
    Restored(PublicProjectTree),
    /// A project tree was permanently deleted.
    #[serde(rename = "project.permanently_deleted")]
    PermanentlyDeleted(PublicProjectTree),
    /// An uploaded project tree was made live.
    #[serde(rename = "project.uploaded")]
    Uploaded(PublicProjectTree),
}

impl TopicEvent for ProjectTopicEvent {
    type Topic = MacroProjectsTopic;

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = ProjectPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, EntityType, Exposure, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        let (name, project_id, audience, payload) = match self {
            Self::Created(metadata) => (
                "project.created",
                &metadata.project_id,
                None,
                ProjectPublicEvent::Created(PublicProjectCreated {
                    project_id: metadata.project_id.clone(),
                    parent_project_id: metadata.parent_project_id.clone(),
                    created_at: metadata.created_at,
                }),
            ),
            Self::Updated(metadata) => (
                "project.updated",
                &metadata.project_id,
                None,
                ProjectPublicEvent::Updated(PublicProjectUpdated {
                    project_id: metadata.project_id.clone(),
                    actor_user_id: metadata.actor_user_id.clone(),
                    changes: [
                        (metadata.name.is_some(), ProjectChange::Name),
                        (metadata.parent_id.is_some(), ProjectChange::Parent),
                        (metadata.share_permission_updated, ProjectChange::Sharing),
                    ]
                    .into_iter()
                    .filter_map(|(changed, change)| changed.then_some(change))
                    .collect(),
                }),
            ),
            Self::Deleted(metadata) => (
                "project.deleted",
                &metadata.project_id,
                None,
                ProjectPublicEvent::Deleted(PublicProjectTree {
                    project_id: metadata.project_id.clone(),
                    parent_project_id: metadata.parent_project_id.clone(),
                    actor_user_id: metadata.actor_user_id.clone(),
                }),
            ),
            Self::Restored(metadata) => (
                "project.restored",
                &metadata.project_id,
                None,
                ProjectPublicEvent::Restored(PublicProjectTree {
                    project_id: metadata.project_id.clone(),
                    parent_project_id: metadata.parent_project_id.clone(),
                    actor_user_id: metadata.actor_user_id.clone(),
                }),
            ),
            // The grants are gone with the tree. A user owner still owns the
            // fact; a team's members or a bot's owner were never the
            // project's audience as such (members without a grant would
            // learn of it), so those stay internal.
            Self::PermanentlyDeleted(metadata) => match &metadata.owner {
                Owner::User(owner) => (
                    "project.permanently_deleted",
                    &metadata.project_id,
                    Some(Audience::Owner {
                        user_id: owner.clone(),
                    }),
                    ProjectPublicEvent::PermanentlyDeleted(PublicProjectTree {
                        project_id: metadata.project_id.clone(),
                        parent_project_id: metadata.parent_project_id.clone(),
                        actor_user_id: metadata.actor_user_id.clone(),
                    }),
                ),
                Owner::Team(_) | Owner::Bot(_) => {
                    return Ok(Exposure::internal_by_design(
                        "a purged team- or bot-owned project has no audience left: its grants are gone and team membership is not access",
                    ));
                }
            },
            Self::Uploaded(metadata) => (
                "project.uploaded",
                &metadata.root_project_id,
                None,
                ProjectPublicEvent::Uploaded(PublicProjectTree {
                    project_id: metadata.root_project_id.clone(),
                    parent_project_id: metadata.parent_project_id.clone(),
                    actor_user_id: None,
                }),
            ),
        };
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::Project, project_id.clone()),
            audience: audience.unwrap_or_else(|| Audience::Entity {
                entity_type: EntityType::Project,
                entity_id: project_id.clone(),
            }),
            stage: Stage::Preview,
            payload: Cow::Owned(payload),
        }))
    }
}

/// Publishable event for [`MacroProjectsTopic`], keyed by the root project id.
pub struct ProjectMacroEvent {
    key: String,
    event: Event<ProjectTopicEvent>,
}

impl ProjectMacroEvent {
    /// Builds a created event keyed by the new project id.
    pub fn created(key: impl Into<String>, metadata: ProjectCreatedMetadata) -> Self {
        Self::new(key, ProjectTopicEvent::Created(metadata))
    }

    /// Builds an updated event keyed by the updated project id.
    pub fn updated(key: impl Into<String>, metadata: ProjectUpdatedMetadata) -> Self {
        Self::new(key, ProjectTopicEvent::Updated(metadata))
    }

    /// Builds a deleted event keyed by the root project id.
    pub fn deleted(key: impl Into<String>, metadata: ProjectDeletedMetadata) -> Self {
        Self::new(key, ProjectTopicEvent::Deleted(metadata))
    }

    /// Builds a restored event keyed by the root project id.
    pub fn restored(key: impl Into<String>, metadata: ProjectRestoredMetadata) -> Self {
        Self::new(key, ProjectTopicEvent::Restored(metadata))
    }

    /// Builds a permanently deleted event keyed by the root project id.
    pub fn permanently_deleted(
        key: impl Into<String>,
        metadata: ProjectPermanentlyDeletedMetadata,
    ) -> Self {
        Self::new(key, ProjectTopicEvent::PermanentlyDeleted(metadata))
    }

    /// Builds an uploaded event keyed by the root project id.
    pub fn uploaded(key: impl Into<String>, metadata: ProjectUploadedMetadata) -> Self {
        Self::new(key, ProjectTopicEvent::Uploaded(metadata))
    }

    /// Builds an event from a topic-specific project event.
    pub fn new(key: impl Into<String>, event: ProjectTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    /// Builds an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<ProjectTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for ProjectMacroEvent {
    type EventPayload = ProjectTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
