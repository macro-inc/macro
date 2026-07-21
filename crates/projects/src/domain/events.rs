//! Kafka event models for the `macro.projects` topic.

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroProjectsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

/// Metadata for [`ProjectTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectCreatedMetadata {
    /// The id of the created project.
    pub project_id: String,
    /// The owner and creator of the project.
    pub owner: MacroUserIdStr<'static>,
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
    pub owner: MacroUserIdStr<'static>,
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
    pub owner: MacroUserIdStr<'static>,
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
    pub owner: MacroUserIdStr<'static>,
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
    pub owner: MacroUserIdStr<'static>,
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
    pub owner: MacroUserIdStr<'static>,
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

impl TopicEvent for ProjectTopicEvent {
    type Topic = MacroProjectsTopic;

    fn schema_version(&self) -> u8 {
        1
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
