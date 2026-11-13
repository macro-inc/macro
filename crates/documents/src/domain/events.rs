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
use model_owner::Owner;
use serde::{Deserialize, Serialize};

use super::models::FileTypeUpdate;

/// Metadata for [`DocumentTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentCreatedMetadata {
    /// The id of the created document.
    pub document_id: String,
    /// The principal who owns the document.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner: Owner,
    /// Who mechanically created the document. Absent on events published
    /// before attribution: ingest derives a user/bot actor from [`Self::owner`].
    /// Team owners fall back to [`Self::on_behalf_of`], then the system bot.
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
    /// Previous and new presentation overrides, in that order; no content edit occurred.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance_change: Option<[model_entity::EntityAppearance; 2]>,
    /// The id of the updated document.
    pub document_id: String,
    /// The owner of the document.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner: Owner,
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
    /// Subtype captured before deletion, so consumers can distinguish tasks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<DocumentSubType>,
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
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner: Owner,
    /// File type of the uploaded object (may differ from the document's own
    /// type, e.g. `pdf` for the converted rendition of a docx).
    pub file_type: FileType,
    /// Version written, or the converted-file marker; `None` for unversioned
    /// writes (mirrors `SearchExtractorMessage::document_version_id`).
    pub document_version_id: Option<String>,
}

/// An editor reported by Sync from an authenticated session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentSyncEditor {
    /// Invocation from the editor's signed document grant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_correlation_id: Option<uuid::Uuid>,
    /// User or bot that performed the edit.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub actor: Actor<'static>,
    /// User represented by an agent, if any.
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

/// Metadata for [`DocumentTopicEvent::SyncContentUpdated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DocumentSyncContentUpdatedMetadata {
    /// The id of the live-collab document whose content changed.
    pub document_id: String,
    /// File type of the sync document, resolved by the document backend.
    pub file_type: FileType,
    /// Version marker for the sync snapshot, when the caller supplies one.
    pub document_version_id: Option<String>,
    /// Legacy single-editor attribution; newer Sync callers send `editors`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this edit belongs on, when different from
    /// [`Self::actor`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
    /// Distinct editors since the preceding snapshot notification.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub editors: Vec<DocumentSyncEditor>,
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
            editors: Vec::new(),
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
    /// The principal who owns the new copy.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner: Owner,
    /// Who mechanically created the copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user whose feed this copy belongs on, when different from the actor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
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

/// An editor of a document content change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct PublicDocumentEditor {
    /// User or bot that edited.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub actor: Actor<'static>,
    /// User the actor acted for, if any.
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

/// Public payload of `document.content_changed`: new bytes were stored or a
/// live document's content moved. Read the document for the content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct PublicDocumentContentChanged {
    /// The document.
    pub document_id: String,
    /// The version written, when the write was versioned.
    pub document_version_id: Option<String>,
    /// Who edited since the previous notification; empty when unknown, as
    /// for uploads.
    pub editors: Vec<PublicDocumentEditor>,
}

/// Public payload of `document.appearance_changed`: the icon or color
/// changed. Read the document for the new appearance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct PublicDocumentAppearanceChanged {
    /// The document.
    pub document_id: String,
    /// Who changed it, when attributable.
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub actor: Option<Actor<'static>>,
    /// The user the actor acted for, if any.
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

/// Thin projections of document edits that were not delivered before
/// projections existed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum DocumentChangePublicEvent {
    /// A document's content changed: an upload or a live-collab snapshot.
    #[serde(rename = "document.content_changed")]
    ContentChanged(PublicDocumentContentChanged),
    /// A document's icon or color changed.
    #[serde(rename = "document.appearance_changed")]
    AppearanceChanged(PublicDocumentAppearanceChanged),
}

/// The public projection of [`DocumentTopicEvent`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(untagged)]
pub enum DocumentPublicEvent {
    /// Lifecycle events delivered unchanged since before projections, so
    /// their wire shape stays exactly the broker's.
    Lifecycle(Box<DocumentTopicEvent>),
    /// Content and appearance edits, as thin projections.
    Change(DocumentChangePublicEvent),
}

impl TopicEvent for DocumentTopicEvent {
    type Topic = MacroDocumentsTopic;

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = DocumentPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, EntityType, Exposure, ExposureError, PendingPhase, PublicEvent,
            Stage,
        };
        use std::borrow::Cow;

        let (name, document_id, stage, payload) = match self {
            Self::Created(metadata) => (
                "document.created",
                &metadata.document_id,
                Stage::Stable,
                None,
            ),
            Self::Updated(metadata) if metadata.appearance_change.is_some() => (
                "document.appearance_changed",
                &metadata.document_id,
                Stage::Preview,
                Some(DocumentChangePublicEvent::AppearanceChanged(
                    PublicDocumentAppearanceChanged {
                        document_id: metadata.document_id.clone(),
                        actor: metadata
                            .actor
                            .clone()
                            .or_else(|| metadata.actor_user_id.clone().map(Actor::new_from_user)),
                        on_behalf_of: metadata.on_behalf_of.clone(),
                    },
                )),
            ),
            Self::Updated(metadata) => (
                "document.updated",
                &metadata.document_id,
                Stage::Stable,
                None,
            ),
            Self::Deleted(metadata) => (
                "document.deleted",
                &metadata.document_id,
                Stage::Stable,
                None,
            ),
            Self::Copied(metadata) => (
                "document.copied",
                &metadata.document_id,
                Stage::Stable,
                None,
            ),
            Self::Interaction(metadata) => (
                "document.interaction",
                &metadata.document_id,
                Stage::Stable,
                None,
            ),
            // An upload and a live-collab snapshot are the same fact to a
            // subscriber: the content moved. The owner is S3 routing, and
            // the file type is the stored rendition's, not the document's.
            Self::ContentUploaded(metadata) => (
                "document.content_changed",
                &metadata.document_id,
                Stage::Preview,
                Some(DocumentChangePublicEvent::ContentChanged(
                    PublicDocumentContentChanged {
                        document_id: metadata.document_id.clone(),
                        document_version_id: metadata.document_version_id.clone(),
                        editors: Vec::new(),
                    },
                )),
            ),
            Self::SyncContentUpdated(metadata) => {
                let editors = if metadata.editors.is_empty() {
                    metadata
                        .actor
                        .iter()
                        .map(|actor| PublicDocumentEditor {
                            actor: actor.clone(),
                            on_behalf_of: metadata.on_behalf_of.clone(),
                        })
                        .collect()
                } else {
                    metadata
                        .editors
                        .iter()
                        .map(|editor| PublicDocumentEditor {
                            actor: editor.actor.clone(),
                            on_behalf_of: editor.on_behalf_of.clone(),
                        })
                        .collect()
                };
                (
                    "document.content_changed",
                    &metadata.document_id,
                    Stage::Preview,
                    Some(DocumentChangePublicEvent::ContentChanged(
                        PublicDocumentContentChanged {
                            document_id: metadata.document_id.clone(),
                            document_version_id: metadata.document_version_id.clone(),
                            editors,
                        },
                    )),
                )
            }
            Self::Purged(_) => {
                return Ok(Exposure::pending(
                    PendingPhase::ProducerChange,
                    "carries only the document id and its grants are gone when consumed; needs Owner plus an audience snapshot",
                ));
            }
        };
        if uuid::Uuid::parse_str(document_id).is_err() {
            return Err(ExposureError::InvalidEntityId {
                entity_type: "document",
                entity_id: document_id.clone(),
            });
        }
        let payload = match payload {
            Some(change) => DocumentPublicEvent::Change(change),
            None => DocumentPublicEvent::Lifecycle(Box::new(self.clone())),
        };
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::Document, document_id.clone()),
            audience: Audience::Entity {
                entity_type: EntityType::Document,
                entity_id: document_id.clone(),
            },
            stage,
            payload: Cow::Owned(payload),
        }))
    }
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
