//! Kafka event models for the `macro.documents` topic.
//!
//! Follows the canonical pattern in `macro_event_broker/examples/example_event.rs`:
//! per-variant metadata structs, a [`TopicEvent`] enum tagged by `event_type`,
//! and a [`MacroEvent`] wrapper keyed by document id.

#[cfg(test)]
mod test;

use activity::Actor;
use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroDocumentsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use serde::{Deserialize, Serialize};

use super::models::FileTypeUpdate;

/// Metadata for [`DocumentTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentCreatedMetadata {
    /// The id of the created document.
    pub document_id: String,
    /// The owner (creator) of the document.
    pub owner: MacroUserIdStr<'static>,
    /// Who mechanically created the document. Absent on events published
    /// before attribution: ingest then treats [`Self::owner`] as the actor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this creation belongs on, when different from
    /// [`Self::actor`]. Absent means the actor is also the subject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
    /// The document name, with any file extension stripped.
    pub document_name: String,
    /// File type of the document, when known.
    pub file_type: Option<FileType>,
    /// Project the document was created in, when any.
    pub project_id: Option<String>,
    /// Sub type (task / snippet), when any.
    pub sub_type: Option<DocumentSubType>,
    /// Creation timestamp reported by the repository.
    pub created_at: Option<DateTime<Utc>>,
}

/// Metadata for [`DocumentTopicEvent::Updated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentUpdatedMetadata {
    /// The id of the updated document.
    pub document_id: String,
    /// The owner of the document.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who performed the update; `None` for
    /// unauthenticated or internal callers.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Who mechanically updated the document. Absent on events published
    /// before attribution, and on user-receipt writes (ingest then uses
    /// [`Self::actor_user_id`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this update belongs on, when different from
    /// [`Self::actor`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
    /// New (cleaned) document name; `None` when unchanged.
    pub document_name: Option<String>,
    /// Project id before the update.
    pub previous_project_id: Option<String>,
    /// New project id; `None` when unchanged, `Some("")` when removed from
    /// its project (mirrors the edit repo args semantics).
    pub project_id: Option<String>,
    /// Requested file type change; `None` when unchanged.
    pub file_type: Option<FileTypeUpdate>,
    /// Whether share permissions were updated.
    pub share_permission_updated: bool,
}

/// Metadata for [`DocumentTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentDeletedMetadata {
    /// The id of the deleted document.
    pub document_id: String,
    /// The authenticated user who deleted the document; `None` for
    /// unauthenticated or internal callers.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Who mechanically deleted the document. Absent on events published
    /// before attribution, and on user-receipt writes (ingest then uses
    /// [`Self::actor_user_id`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this delete belongs on, when different from
    /// [`Self::actor`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
    /// Project the document belonged to, when any.
    pub project_id: Option<String>,
}

/// Metadata for [`DocumentTopicEvent::ContentUploaded`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentContentUploadedMetadata {
    /// The id of the document whose stored bytes changed.
    pub document_id: String,
    /// The owner of the document (used by the extractor to resolve S3 keys).
    pub owner: MacroUserIdStr<'static>,
    /// File type of the uploaded object (may differ from the document's own
    /// type, e.g. `pdf` for the converted rendition of a docx).
    pub file_type: FileType,
    /// Version written, or the converted-file marker; `None` for unversioned
    /// writes (mirrors `SearchExtractorMessage::document_version_id`).
    pub document_version_id: Option<String>,
}

/// Metadata for [`DocumentTopicEvent::SyncContentUpdated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentSyncContentUpdatedMetadata {
    /// The id of the live-collab document whose content changed.
    pub document_id: String,
    /// File type of the sync document (markdown today).
    pub file_type: FileType,
    /// Version marker for the sync snapshot, when the caller supplies one.
    pub document_version_id: Option<String>,
    /// Who mechanically changed the content. Absent on events published
    /// before attribution, and on human-only collab sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this edit belongs on, when different from
    /// [`Self::actor`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

impl DocumentSyncContentUpdatedMetadata {
    /// Build metadata from extract-sync strings. Invalid actor or subject
    /// ids are dropped so a bad payload still extracts the document.
    pub fn from_extract(
        document_id: String,
        file_type: FileType,
        document_version_id: Option<String>,
        actor: Option<String>,
        on_behalf_of: Option<String>,
    ) -> Self {
        Self {
            document_id,
            file_type,
            document_version_id,
            actor: actor.and_then(|id| Actor::try_from(id).ok()),
            on_behalf_of: on_behalf_of.and_then(|id| MacroUserIdStr::try_from(id).ok()),
        }
    }
}

/// Metadata for [`DocumentTopicEvent::Purged`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentPurgedMetadata {
    /// The id of the hard-deleted document.
    pub document_id: String,
}

/// Why a document interaction was reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum InteractionReason {
    /// A periodic save of pending content changes.
    Edited,
    /// The first peer joined the document session.
    FirstJoin,
    /// The last connected peer left the document session.
    LastLeave,
}

/// Metadata for [`DocumentTopicEvent::Interaction`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentInteractionMetadata {
    /// The id of the document.
    pub document_id: String,
    /// What triggered this interaction.
    pub reason: InteractionReason,
}

/// Metadata for [`DocumentTopicEvent::Copied`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentCopiedMetadata {
    /// The id of the newly created copy.
    pub document_id: String,
    /// The id of the document that was copied.
    pub source_document_id: String,
    /// The specific source version copied, when requested.
    pub source_version_id: Option<i64>,
    /// The owner of the new copy (the copier).
    pub owner: MacroUserIdStr<'static>,
    /// The name of the new document.
    pub document_name: String,
    /// File type of the document, when known.
    pub file_type: Option<FileType>,
    /// Project the copy belongs to, when any.
    pub project_id: Option<String>,
    /// Sub type (task / snippet), when any.
    pub sub_type: Option<DocumentSubType>,
}

/// Events that can be published to [`MacroDocumentsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum DocumentTopicEvent {
    /// A document was created.
    #[serde(rename = "document.created")]
    Created(DocumentCreatedMetadata),
    /// A document's metadata / permissions were updated.
    #[serde(rename = "document.updated")]
    Updated(DocumentUpdatedMetadata),
    /// A document was soft-deleted.
    #[serde(rename = "document.deleted")]
    Deleted(DocumentDeletedMetadata),
    /// The document's stored bytes were (re)written to S3.
    #[serde(rename = "document.content_uploaded")]
    ContentUploaded(DocumentContentUploadedMetadata),
    /// A live-collab (sync) document's content changed and should be re-extracted.
    #[serde(rename = "document.sync_content_updated")]
    SyncContentUpdated(DocumentSyncContentUpdatedMetadata),
    /// The document row was permanently deleted (hard delete).
    #[serde(rename = "document.purged")]
    Purged(DocumentPurgedMetadata),
    /// A document was copied.
    #[serde(rename = "document.copied")]
    Copied(DocumentCopiedMetadata),
    /// A peer joined, left, or a periodic save occurred.
    #[serde(rename = "document.interaction")]
    Interaction(DocumentInteractionMetadata),
}

impl TopicEvent for DocumentTopicEvent {
    type Topic = MacroDocumentsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroDocumentsTopic`], keyed by document id.
pub struct DocumentMacroEvent {
    key: String,
    event: Event<DocumentTopicEvent>,
}

impl DocumentMacroEvent {
    /// Build a created event keyed by the new document id.
    pub fn created(key: impl Into<String>, metadata: DocumentCreatedMetadata) -> Self {
        Self::new(key, DocumentTopicEvent::Created(metadata))
    }

    /// Build an updated event keyed by the updated document id.
    pub fn updated(key: impl Into<String>, metadata: DocumentUpdatedMetadata) -> Self {
        Self::new(key, DocumentTopicEvent::Updated(metadata))
    }

    /// Build a deleted event keyed by the deleted document id.
    pub fn deleted(key: impl Into<String>, metadata: DocumentDeletedMetadata) -> Self {
        Self::new(key, DocumentTopicEvent::Deleted(metadata))
    }

    /// Build a content-uploaded event keyed by the document id.
    pub fn content_uploaded(
        key: impl Into<String>,
        metadata: DocumentContentUploadedMetadata,
    ) -> Self {
        Self::new(key, DocumentTopicEvent::ContentUploaded(metadata))
    }

    /// Build a sync-content-updated event keyed by the document id.
    pub fn sync_content_updated(
        key: impl Into<String>,
        metadata: DocumentSyncContentUpdatedMetadata,
    ) -> Self {
        Self::new(key, DocumentTopicEvent::SyncContentUpdated(metadata))
    }

    /// Build a purged event keyed by the document id.
    pub fn purged(key: impl Into<String>, metadata: DocumentPurgedMetadata) -> Self {
        Self::new(key, DocumentTopicEvent::Purged(metadata))
    }

    /// Build a copied event keyed by the new document id.
    pub fn copied(key: impl Into<String>, metadata: DocumentCopiedMetadata) -> Self {
        Self::new(key, DocumentTopicEvent::Copied(metadata))
    }

    /// Build an interaction event keyed by the document id.
    pub fn interaction(key: impl Into<String>, metadata: DocumentInteractionMetadata) -> Self {
        Self::new(key, DocumentTopicEvent::Interaction(metadata))
    }

    /// Build an event from a topic-specific event variant.
    pub fn new(key: impl Into<String>, event: DocumentTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<DocumentTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for DocumentMacroEvent {
    type EventPayload = DocumentTopicEvent;

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
