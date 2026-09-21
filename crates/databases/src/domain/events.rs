//! Kafka event models for the `macro.databases` topic.
//!
//! Follows the canonical pattern in `macro_event_broker/examples/example_event.rs`:
//! per-variant metadata structs, a [`TopicEvent`] enum tagged by `event_type`,
//! and a [`MacroEvent`] wrapper keyed by database id.
//!
//! These are the durable facts other domains consume (activity today). The
//! gateway fan-out that keeps open grids fresh is a separate, best-effort
//! liveness channel; see `outbound::gateway_event_publisher`.

use activity::Actor;
use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroDatabasesTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::models::{TableId, TableVersion};

/// Who performed a write: the principal that mechanically acted and, when a
/// bot acted for a user, the user whose feed the action belongs on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attribution {
    /// Who mechanically acted.
    pub actor: Actor<'static>,
    /// The user the actor acted for, when different from the actor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

impl Attribution {
    /// A user acting for themselves.
    pub fn user(user: MacroUserIdStr<'static>) -> Self {
        Self {
            actor: Actor::new_from_user(user),
            on_behalf_of: None,
        }
    }
}

/// Metadata for [`DatabaseTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseCreatedMetadata {
    /// The id of the created database.
    pub database_id: String,
    /// The owner (creator) of the database.
    pub owner: MacroUserIdStr<'static>,
    /// The display name it was created with.
    pub name: String,
    /// Creation timestamp reported by the repository.
    pub created_at: DateTime<Utc>,
}

/// Metadata for [`DatabaseTopicEvent::Renamed`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseRenamedMetadata {
    /// The id of the renamed database.
    pub database_id: String,
    /// Who renamed it; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
    /// The new display name.
    pub name: String,
}

/// Metadata for [`DatabaseTopicEvent::Trashed`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseTrashedMetadata {
    /// The id of the trashed database.
    pub database_id: String,
    /// Who trashed it; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}

/// Metadata for [`DatabaseTopicEvent::Restored`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseRestoredMetadata {
    /// The id of the restored database.
    pub database_id: String,
    /// Who restored it; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}

/// Metadata for [`DatabaseTopicEvent::Purged`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabasePurgedMetadata {
    /// The id of the permanently deleted database.
    pub database_id: String,
}

/// One table whose contents or shape moved, and the version it moved to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableVersionChange {
    /// The table written.
    pub table_id: TableId,
    /// Its version after the write.
    pub version: TableVersion,
}

/// Metadata for [`DatabaseTopicEvent::TablesChanged`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseTablesChangedMetadata {
    /// The database the tables belong to.
    pub database_id: String,
    /// Who wrote; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
    /// Every table of this database the write touched.
    pub tables: Vec<TableVersionChange>,
}

/// Events that can be published to [`MacroDatabasesTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum DatabaseTopicEvent {
    /// A database was created.
    #[serde(rename = "database.created")]
    Created(DatabaseCreatedMetadata),
    /// A database's display name changed.
    #[serde(rename = "database.renamed")]
    Renamed(DatabaseRenamedMetadata),
    /// A database was soft-deleted.
    #[serde(rename = "database.trashed")]
    Trashed(DatabaseTrashedMetadata),
    /// A trashed database was brought back.
    #[serde(rename = "database.restored")]
    Restored(DatabaseRestoredMetadata),
    /// A database and everything in it was permanently deleted.
    #[serde(rename = "database.purged")]
    Purged(DatabasePurgedMetadata),
    /// Rows or schema changed in one or more tables of a database. One
    /// event per database per write, however many tables the write touched.
    #[serde(rename = "database.tables_changed")]
    TablesChanged(DatabaseTablesChangedMetadata),
}

impl TopicEvent for DatabaseTopicEvent {
    type Topic = MacroDatabasesTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroDatabasesTopic`], keyed by database id.
pub struct DatabaseMacroEvent {
    key: String,
    event: Event<DatabaseTopicEvent>,
}

impl DatabaseMacroEvent {
    /// Build a created event keyed by the new database id.
    pub fn created(metadata: DatabaseCreatedMetadata) -> Self {
        Self::new(
            metadata.database_id.clone(),
            DatabaseTopicEvent::Created(metadata),
        )
    }

    /// Build a renamed event keyed by the database id.
    pub fn renamed(metadata: DatabaseRenamedMetadata) -> Self {
        Self::new(
            metadata.database_id.clone(),
            DatabaseTopicEvent::Renamed(metadata),
        )
    }

    /// Build a trashed event keyed by the database id.
    pub fn trashed(metadata: DatabaseTrashedMetadata) -> Self {
        Self::new(
            metadata.database_id.clone(),
            DatabaseTopicEvent::Trashed(metadata),
        )
    }

    /// Build a restored event keyed by the database id.
    pub fn restored(metadata: DatabaseRestoredMetadata) -> Self {
        Self::new(
            metadata.database_id.clone(),
            DatabaseTopicEvent::Restored(metadata),
        )
    }

    /// Build a purged event keyed by the database id.
    pub fn purged(metadata: DatabasePurgedMetadata) -> Self {
        Self::new(
            metadata.database_id.clone(),
            DatabaseTopicEvent::Purged(metadata),
        )
    }

    /// Build a tables-changed event keyed by the database id.
    pub fn tables_changed(metadata: DatabaseTablesChangedMetadata) -> Self {
        Self::new(
            metadata.database_id.clone(),
            DatabaseTopicEvent::TablesChanged(metadata),
        )
    }

    /// Build an event from a topic-specific event variant.
    pub fn new(key: impl Into<String>, event: DatabaseTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<DatabaseTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for DatabaseMacroEvent {
    type EventPayload = DatabaseTopicEvent;

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
