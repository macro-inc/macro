//! A synced table, where it reads from, and how its last run went.

use chrono::{DateTime, Utc};
use databases::domain::models::DatabaseError;
use import_notion::domain::model::NotionId;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{ColumnId, DatabaseId, TableId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A sync's id.
pub type SyncId = Uuid;

/// What a synced table mirrors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncSource)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncSource {
    /// The creator's meetings imported from Granola.
    GranolaMeetings,
    /// One Notion data source (a Notion database's table), read through the
    /// creator's Notion connection.
    #[serde(rename_all = "camelCase")]
    NotionDataSource {
        /// The data source.
        #[schema(value_type = String)]
        data_source_id: NotionId,
    },
}

impl SyncSource {
    /// Which kind of source it is.
    pub fn kind(&self) -> SourceKind {
        match self {
            SyncSource::GranolaMeetings => SourceKind::GranolaMeetings,
            SyncSource::NotionDataSource { .. } => SourceKind::NotionDataSource,
        }
    }
}

/// A kind of source, as stored.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::AsRefStr, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SourceKind {
    /// Granola meetings.
    GranolaMeetings,
    /// A Notion data source.
    NotionDataSource,
}

/// One field of a Granola meeting a synced table keeps.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::AsRefStr,
)]
#[schema(as = DatabaseSyncGranolaField)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum GranolaField {
    /// The meeting's title.
    Title,
    /// When it started.
    Date,
    /// Who attended, by name.
    Attendees,
    /// Granola's summary.
    Summary,
    /// The meeting in Granola.
    Link,
    /// The meeting's call in Macro.
    Call,
}

/// A source field a column of a synced table holds.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncField)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum SyncField {
    /// A field of a Granola meeting.
    Granola {
        /// Which one.
        field: GranolaField,
    },
    /// A property of a Notion data source.
    #[serde(rename_all = "camelCase")]
    Notion {
        /// The property's id, which survives renames.
        property_id: String,
    },
}

/// A column the sync writes, and the field it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncColumn)]
#[serde(rename_all = "camelCase")]
pub struct SyncedColumn {
    /// The source field.
    pub field: SyncField,
    /// The column.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
}

/// Why a column stopped syncing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncDetachReason)]
#[serde(rename_all = "snake_case")]
pub enum DetachReason {
    /// Someone deleted the column.
    Deleted,
    /// The column's type changed, in Macro or in the source, so the field's
    /// values no longer fit it.
    TypeChanged,
}

/// A column that no longer syncs. Its cells stay as they are, and the sync
/// never adds its field back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncDetachedColumn)]
#[serde(rename_all = "camelCase")]
pub struct DetachedColumn {
    /// The source field it held.
    pub field: SyncField,
    /// The column.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
    /// Why it stopped.
    pub reason: DetachReason,
}

/// Why a sync's last run failed.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[schema(as = DatabaseSyncFailure)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SyncFailure {
    /// The creator's connection to the source is gone or turned off.
    SourceDisconnected,
    /// The source no longer exists, or the connection may not read it.
    SourceNotFound,
    /// The source could not be read just now.
    SourceUnavailable,
    /// The sync's creator can no longer edit the database.
    CreatorLostAccess,
    /// The database is trashed or its table is gone.
    DatabaseUnavailable,
    /// Macro failed to write the table.
    Internal,
}

/// How a sync stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncStatus)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SyncStatus {
    /// It has not run yet.
    Pending,
    /// Its last run succeeded.
    Synced,
    /// Its last run failed; it tries again on its schedule.
    Failed {
        /// Why.
        failure: SyncFailure,
    },
}

/// A table of a database kept in sync with a source.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSync {
    /// Identifier.
    #[schema(value_type = Uuid)]
    pub id: SyncId,
    /// The database.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// The table the sync writes.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// Who created it; its writes act with their access and read the source
    /// through their connection.
    #[schema(value_type = String)]
    pub created_by: MacroUserIdStr<'static>,
    /// What it mirrors.
    pub source: SyncSource,
    /// The columns it writes.
    pub columns: Vec<SyncedColumn>,
    /// The columns it stopped writing.
    pub detached_columns: Vec<DetachedColumn>,
    /// How its last run went.
    pub status: SyncStatus,
    /// When a run last succeeded.
    #[schema(required = true)]
    pub last_synced_at: Option<DateTime<Utc>>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

/// A sync to create, under an id its client minted so a retry finds it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, utoipa::ToSchema)]
#[schema(as = CreateDatabaseSyncRequest)]
#[serde(rename_all = "camelCase")]
pub struct NewSync {
    /// Its id, minted by the client (UUIDv7).
    #[schema(value_type = Uuid)]
    pub id: SyncId,
    /// What it mirrors.
    pub source: SyncSource,
}

/// A sync as it is first stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSyncRecord {
    /// Identifier.
    pub id: SyncId,
    /// The database.
    pub database_id: DatabaseId,
    /// The table.
    pub table_id: TableId,
    /// Who created it.
    pub created_by: MacroUserIdStr<'static>,
    /// What it mirrors.
    pub source: SyncSource,
    /// The columns it starts with.
    pub columns: Vec<SyncedColumn>,
}

/// A Notion data source the creator's connection can read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncNotionDataSource)]
#[serde(rename_all = "camelCase")]
pub struct NotionDataSourceSummary {
    /// The data source.
    #[schema(value_type = String)]
    pub id: NotionId,
    /// Its title.
    pub title: String,
}

/// Whether the user has connected Granola.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncGranolaSource)]
#[serde(rename_all = "camelCase")]
pub struct GranolaAvailability {
    /// Whether a Granola connection syncs meetings into Macro.
    pub connected: bool,
}

/// Whether the user has connected Notion, and what it can read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncNotionSource)]
#[serde(rename_all = "camelCase")]
pub struct NotionAvailability {
    /// Whether Notion is connected.
    pub connected: bool,
    /// The data sources the connection can read, most recently edited
    /// first; empty when not connected.
    pub data_sources: Vec<NotionDataSourceSummary>,
}

/// What a user can sync a table from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[schema(as = DatabaseSyncSources)]
#[serde(rename_all = "camelCase")]
pub struct AvailableSources {
    /// Granola meetings.
    pub granola: GranolaAvailability,
    /// Notion data sources.
    pub notion: NotionAvailability,
}

/// A sync a worker holds until its lease runs out.
#[derive(Debug, Clone, PartialEq)]
pub struct ClaimedSync {
    /// The sync.
    pub sync: DatabaseSync,
    /// The lease; finishing the run takes it.
    pub lease: Uuid,
}

/// What a run leaves behind.
#[derive(Debug, Clone, PartialEq)]
pub struct FinishedRun {
    /// The columns it writes now.
    pub columns: Vec<SyncedColumn>,
    /// The columns it stopped writing.
    pub detached_columns: Vec<DetachedColumn>,
    /// `None` when the run succeeded.
    pub failure: Option<SyncFailure>,
    /// When it runs next, unless something marks it due sooner.
    pub next_run_in: std::time::Duration,
}

/// Why a sync use case failed.
#[derive(Debug, thiserror::Error)]
pub enum DatabaseSyncError {
    /// No such sync or database, or none the caller can see.
    #[error("not found")]
    NotFound,
    /// The caller may not do this.
    #[error("{0}")]
    Forbidden(&'static str),
    /// The id names another sync.
    #[error("the id names another sync")]
    IdTaken,
    /// The user has not connected the source.
    #[error("connect the source first")]
    SourceDisconnected,
    /// The source does not exist, or the connection may not read it.
    #[error("the source was not found, or the connection may not read it")]
    SourceNotFound,
    /// The source could not be read.
    #[error("the source could not be read: {0}")]
    SourceUnavailable(rootcause::Report),
    /// The databases service refused or failed.
    #[error("{0}")]
    Database(DatabaseError),
    /// Persistence failure.
    #[error("repository error: {0}")]
    Repository(rootcause::Report),
}
