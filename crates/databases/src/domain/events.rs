//! The durable `macro.databases` events other domains consume; open grids'
//! liveness pings are the separate `TableEventPublisher`.

use activity::Actor;
use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroDatabasesTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::models::{DatabaseId, TableId, TableVersion};

#[cfg(test)]
mod test;

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

    /// `user` acting, or `bot` acting for them.
    pub fn acting(user: MacroUserIdStr<'static>, bot: Option<BotId>) -> Self {
        match bot {
            Some(bot) => Self {
                actor: Actor::new_from_bot(bot),
                on_behalf_of: Some(user),
            },
            None => Self::user(user),
        }
    }
}

/// Metadata for [`DatabaseTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseCreatedMetadata {
    /// The id of the created database.
    pub database_id: DatabaseId,
    /// The owner (creator) of the database.
    pub owner: MacroUserIdStr<'static>,
    /// The display name it was created with.
    pub name: String,
    /// Creation timestamp reported by the repository.
    pub created_at: DateTime<Utc>,
    /// Who created it.
    pub attribution: Attribution,
}

/// Metadata for [`DatabaseTopicEvent::Renamed`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseRenamedMetadata {
    /// The id of the renamed database.
    pub database_id: DatabaseId,
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
    pub database_id: DatabaseId,
    /// Who trashed it; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}

/// Metadata for [`DatabaseTopicEvent::Restored`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseRestoredMetadata {
    /// The id of the restored database.
    pub database_id: DatabaseId,
    /// Who restored it; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}

/// Metadata for [`DatabaseTopicEvent::Purged`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabasePurgedMetadata {
    /// The id of the permanently deleted database.
    pub database_id: DatabaseId,
}

/// Metadata for [`DatabaseTopicEvent::SharingChanged`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseSharingChangedMetadata {
    /// The database whose sharing changed.
    pub database_id: DatabaseId,
    /// Who changed it; `None` for internal callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
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
    pub database_id: DatabaseId,
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
    /// Who the database is shared with changed.
    #[serde(rename = "database.sharing_changed")]
    SharingChanged(DatabaseSharingChangedMetadata),
    /// Icon or color metadata changed without touching content recency.
    #[serde(rename = "database.appearance_changed")]
    AppearanceChanged {
        /// The database entity.
        database_id: DatabaseId,
        /// The editor, when authenticated.
        attribution: Option<Attribution>,
        /// Previous and saved appearance.
        change: activity::AppearanceChange,
    },
}

/// Public payload of most `database.*` events: which database changed, who
/// did it and nothing else. Read the database for its new state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicDatabaseChange {
    /// The database.
    #[schema(value_type = String)]
    pub database_id: DatabaseId,
    /// Who acted, when attributable.
    #[schema(value_type = Option<String>)]
    pub actor: Option<Actor<'static>>,
    /// The user the actor acted for, when different from the actor.
    #[schema(value_type = Option<String>)]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
}

impl PublicDatabaseChange {
    fn new(database_id: &DatabaseId, attribution: Option<&Attribution>) -> Self {
        Self {
            database_id: *database_id,
            actor: attribution.map(|by| by.actor.clone()),
            on_behalf_of: attribution.and_then(|by| by.on_behalf_of.clone()),
        }
    }
}

/// Public payload of `database.created`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicDatabaseCreated {
    /// The created database, with who created it.
    #[serde(flatten)]
    pub change: PublicDatabaseChange,
    /// Creation time reported by the repository.
    pub created_at: DateTime<Utc>,
}

/// One table a write touched and the version it moved to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicTableVersion {
    /// The table written.
    #[schema(value_type = String)]
    pub table_id: TableId,
    /// Its version after the write.
    #[schema(value_type = i64)]
    pub version: TableVersion,
}

/// Public payload of `database.tables_changed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicDatabaseTablesChanged {
    /// The database, with who wrote.
    #[serde(flatten)]
    pub change: PublicDatabaseChange,
    /// Every table the write touched; read them for their rows.
    pub tables: Vec<PublicTableVersion>,
}

/// The public projection of [`DatabaseTopicEvent`], delivered under the same
/// event names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(tag = "event_type", content = "metadata")]
pub enum DatabasePublicEvent {
    /// A database was created.
    #[serde(rename = "database.created")]
    Created(PublicDatabaseCreated),
    /// A database was renamed.
    #[serde(rename = "database.renamed")]
    Renamed(PublicDatabaseChange),
    /// A database was moved to the trash.
    #[serde(rename = "database.trashed")]
    Trashed(PublicDatabaseChange),
    /// A database was restored from the trash.
    #[serde(rename = "database.restored")]
    Restored(PublicDatabaseChange),
    /// Rows or schema changed in one or more tables.
    #[serde(rename = "database.tables_changed")]
    TablesChanged(PublicDatabaseTablesChanged),
    /// Who the database is shared with changed.
    #[serde(rename = "database.sharing_changed")]
    SharingChanged(PublicDatabaseChange),
    /// The database's icon or color changed.
    #[serde(rename = "database.appearance_changed")]
    AppearanceChanged(PublicDatabaseChange),
}

impl TopicEvent for DatabaseTopicEvent {
    type Topic = MacroDatabasesTopic;

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = DatabasePublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, EntityType, Exposure, PendingPhase, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        let (name, database_id, payload) = match self {
            Self::Created(metadata) => (
                "database.created",
                &metadata.database_id,
                DatabasePublicEvent::Created(PublicDatabaseCreated {
                    change: PublicDatabaseChange::new(
                        &metadata.database_id,
                        Some(&metadata.attribution),
                    ),
                    created_at: metadata.created_at,
                }),
            ),
            Self::Renamed(metadata) => (
                "database.renamed",
                &metadata.database_id,
                DatabasePublicEvent::Renamed(PublicDatabaseChange::new(
                    &metadata.database_id,
                    metadata.attribution.as_ref(),
                )),
            ),
            Self::Trashed(metadata) => (
                "database.trashed",
                &metadata.database_id,
                DatabasePublicEvent::Trashed(PublicDatabaseChange::new(
                    &metadata.database_id,
                    metadata.attribution.as_ref(),
                )),
            ),
            Self::Restored(metadata) => (
                "database.restored",
                &metadata.database_id,
                DatabasePublicEvent::Restored(PublicDatabaseChange::new(
                    &metadata.database_id,
                    metadata.attribution.as_ref(),
                )),
            ),
            Self::TablesChanged(metadata) => (
                "database.tables_changed",
                &metadata.database_id,
                DatabasePublicEvent::TablesChanged(PublicDatabaseTablesChanged {
                    change: PublicDatabaseChange::new(
                        &metadata.database_id,
                        metadata.attribution.as_ref(),
                    ),
                    tables: metadata
                        .tables
                        .iter()
                        .map(|table| PublicTableVersion {
                            table_id: table.table_id,
                            version: table.version,
                        })
                        .collect(),
                }),
            ),
            Self::SharingChanged(metadata) => (
                "database.sharing_changed",
                &metadata.database_id,
                DatabasePublicEvent::SharingChanged(PublicDatabaseChange::new(
                    &metadata.database_id,
                    metadata.attribution.as_ref(),
                )),
            ),
            Self::AppearanceChanged {
                database_id,
                attribution,
                ..
            } => (
                "database.appearance_changed",
                database_id,
                DatabasePublicEvent::AppearanceChanged(PublicDatabaseChange::new(
                    database_id,
                    attribution.as_ref(),
                )),
            ),
            Self::Purged(_) => {
                return Ok(Exposure::pending(
                    PendingPhase::ProducerChange,
                    "carries only the database id and its grants are gone when consumed; needs Owner plus an audience snapshot",
                ));
            }
        };
        let database_id = database_id.to_string();
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::Database, database_id.clone()),
            audience: Audience::Entity {
                entity_type: EntityType::Database,
                entity_id: database_id,
            },
            stage: Stage::Preview,
            payload: Cow::Owned(payload),
        }))
    }
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
            metadata.database_id.to_string(),
            DatabaseTopicEvent::Created(metadata),
        )
    }

    /// Build a renamed event keyed by the database id.
    pub fn renamed(metadata: DatabaseRenamedMetadata) -> Self {
        Self::new(
            metadata.database_id.to_string(),
            DatabaseTopicEvent::Renamed(metadata),
        )
    }

    /// Build a trashed event keyed by the database id.
    pub fn trashed(metadata: DatabaseTrashedMetadata) -> Self {
        Self::new(
            metadata.database_id.to_string(),
            DatabaseTopicEvent::Trashed(metadata),
        )
    }

    /// Build a restored event keyed by the database id.
    pub fn restored(metadata: DatabaseRestoredMetadata) -> Self {
        Self::new(
            metadata.database_id.to_string(),
            DatabaseTopicEvent::Restored(metadata),
        )
    }

    /// Build a purged event keyed by the database id.
    pub fn purged(metadata: DatabasePurgedMetadata) -> Self {
        Self::new(
            metadata.database_id.to_string(),
            DatabaseTopicEvent::Purged(metadata),
        )
    }

    /// Build a tables-changed event keyed by the database id.
    pub fn tables_changed(metadata: DatabaseTablesChangedMetadata) -> Self {
        Self::new(
            metadata.database_id.to_string(),
            DatabaseTopicEvent::TablesChanged(metadata),
        )
    }

    /// Build a sharing-changed event keyed by the database id.
    pub fn sharing_changed(metadata: DatabaseSharingChangedMetadata) -> Self {
        Self::new(
            metadata.database_id.to_string(),
            DatabaseTopicEvent::SharingChanged(metadata),
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
