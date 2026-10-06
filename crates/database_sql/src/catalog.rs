//! What the caller can see: tables, their columns, and the columns' types and
//! select options. Built once per request by [`build`] from a [`Schema`] of
//! the databases the viewer has access to; a table that is not in the catalog
//! does not exist as far as a query is concerned. It crosses the wasm
//! boundary as JSON, in camel case.

mod schema;

use models_databases::EntityKind as OpEntityKind;
use models_databases::cast::CastKind;
use models_databases::{ColumnId, DatabaseId, OptionId, TableId};
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

pub use schema::{
    ColumnSchema, DataType, DatabaseSchema, OptionSchema, OptionValue, PlatformTable, PropertyType,
    Schema, TableSchema, build,
};

/// Every table a statement may name.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// The visible tables.
    pub tables: Vec<Table>,
    /// The database whose tables win when an unqualified name matches several.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<DatabaseId>,
}

/// One table and its columns, in display order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    /// The table id.
    pub id: TableId,
    /// The database the table belongs to: where its writes are sent.
    pub database_id: DatabaseId,
    /// The database the table belongs to, as users name it.
    pub database: String,
    /// The table's name, as users name it.
    pub name: String,
    /// The columns, in display order.
    pub columns: Vec<Column>,
    /// Where its rows come from.
    #[serde(default)]
    pub source: TableSource,
}

/// Where a table's rows come from. The engine only says which; the driver
/// serving its fetch requests decides how.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TableSource {
    /// A Macro database table, read through Soup.
    #[default]
    Database,
    /// The people the viewer can see: `id`, `name`, `email`.
    People,
}

/// The database platform tables belong to. Nothing is written there.
pub const PLATFORM_DATABASE: DatabaseId =
    DatabaseId::from_uuid(Uuid::from_u128(0x6d61_6372_6f00_0000_0000_0000_0000_0000));
/// The id of the `people` table. Platform tables have fixed ids, so a saved
/// query keeps meaning the same thing.
pub const PEOPLE_TABLE: TableId =
    TableId::from_uuid(Uuid::from_u128(0x6d61_6372_6f00_0000_0000_0000_7065_6f70));
/// `people.id`: the user's entity id.
pub const PEOPLE_ID: Uuid = Uuid::from_u128(0x6d61_6372_6f00_0000_0000_0000_7065_6f71);
/// `people.name`.
pub const PEOPLE_NAME: Uuid = Uuid::from_u128(0x6d61_6372_6f00_0000_0000_0000_7065_6f72);
/// `people.email`.
pub const PEOPLE_EMAIL: Uuid = Uuid::from_u128(0x6d61_6372_6f00_0000_0000_0000_7065_6f73);

/// The `macro.people` table: every person the viewer can see, keyed by
/// entity id so entity columns join to it. Its `id` cells are
/// [`crate::fold::Cell::Entities`] with one id each.
pub fn people_table() -> Table {
    Table {
        id: PEOPLE_TABLE,
        database_id: PLATFORM_DATABASE,
        database: "macro".into(),
        name: "people".into(),
        columns: vec![
            Column {
                id: PEOPLE_ID,
                placement: ColumnId::from_uuid(PEOPLE_ID),
                name: "id".into(),
                kind: ColumnKind::Entity {
                    multi: false,
                    target: EntityKind::User,
                },
            },
            Column {
                id: PEOPLE_NAME,
                placement: ColumnId::from_uuid(PEOPLE_NAME),
                name: "name".into(),
                kind: ColumnKind::Text,
            },
            Column {
                id: PEOPLE_EMAIL,
                placement: ColumnId::from_uuid(PEOPLE_EMAIL),
                name: "email".into(),
                kind: ColumnKind::Text,
            },
        ],
        source: TableSource::People,
    }
}

/// One column: a property definition bound to the table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    /// The property definition id: what reads key cells by.
    pub id: Uuid,
    /// The column placement: what writes name.
    pub placement: ColumnId,
    /// The column's display name.
    pub name: String,
    /// What the column holds.
    pub kind: ColumnKind,
}

/// The value type of a column, mirroring the property data types a query can
/// compare against. The static string form is how the kind reads in an
/// error message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, strum::IntoStaticStr)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[strum(serialize_all = "lowercase")]
pub enum ColumnKind {
    /// Free text.
    Text,
    /// A number.
    Number,
    /// A checkbox.
    #[strum(serialize = "checkbox")]
    Boolean,
    /// A date-time.
    Date,
    /// A URL.
    Link,
    /// One or more of a fixed set of options.
    Select {
        /// Whether a cell holds several options.
        multi: bool,
        /// The options, in display order.
        options: Vec<SelectOption>,
    },
    /// One or more references to Macro entities.
    Entity {
        /// Whether a cell holds several references.
        multi: bool,
        /// What the references point at.
        target: EntityKind,
    },
}

/// What an entity column's references point at: a kind of Macro entity, or
/// the rows of another table for a relation.
///
/// Spelled as the properties system spells entity types (`USER`,
/// `DATABASE_ROW`), on the wire and in SQL, where it parses
/// case-insensitively.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    Type,
    strum::EnumString,
    strum::IntoStaticStr,
    strum::EnumIter,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE", ascii_case_insensitive)]
pub enum EntityKind {
    /// People.
    User,
    /// Documents.
    Document,
    /// Tasks.
    Task,
    /// CRM companies.
    Company,
    /// CRM contacts.
    Contact,
    /// Call recordings.
    CallRecord,
    /// Channels.
    Channel,
    /// AI chats.
    Chat,
    /// Projects.
    Project,
    /// Email threads.
    Thread,
    /// Calendar events.
    CalendarEvent,
    /// Initiatives.
    Initiative,
    /// Rows of another table: the column is a relation.
    #[serde(rename = "DATABASE_ROW")]
    #[strum(serialize = "DATABASE_ROW")]
    Row,
}

impl EntityKind {
    /// The name SQL and the agent tools use for the kind.
    pub fn sql_name(self) -> &'static str {
        self.into()
    }
}

/// A relation's target, which an op names as rows rather than as an
/// entity kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a relation points at rows, not at an entity kind")]
pub struct RelationTarget;

impl TryFrom<EntityKind> for OpEntityKind {
    type Error = RelationTarget;

    fn try_from(kind: EntityKind) -> Result<Self, Self::Error> {
        Ok(match kind {
            EntityKind::User => OpEntityKind::User,
            EntityKind::Document => OpEntityKind::Document,
            EntityKind::Task => OpEntityKind::Task,
            EntityKind::Company => OpEntityKind::Company,
            EntityKind::Contact => OpEntityKind::Contact,
            EntityKind::CallRecord => OpEntityKind::CallRecord,
            EntityKind::Channel => OpEntityKind::Channel,
            EntityKind::Chat => OpEntityKind::Chat,
            EntityKind::Project => OpEntityKind::Project,
            EntityKind::Thread => OpEntityKind::Thread,
            EntityKind::CalendarEvent => OpEntityKind::CalendarEvent,
            EntityKind::Initiative => OpEntityKind::Initiative,
            EntityKind::Row => return Err(RelationTarget),
        })
    }
}

/// One option of a select column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SelectOption {
    /// The option id.
    pub id: OptionId,
    /// The label users type in SQL.
    pub label: String,
}

impl From<OpEntityKind> for EntityKind {
    fn from(kind: OpEntityKind) -> Self {
        match kind {
            OpEntityKind::User => EntityKind::User,
            OpEntityKind::Document => EntityKind::Document,
            OpEntityKind::Task => EntityKind::Task,
            OpEntityKind::Company => EntityKind::Company,
            OpEntityKind::Contact => EntityKind::Contact,
            OpEntityKind::CallRecord => EntityKind::CallRecord,
            OpEntityKind::Channel => EntityKind::Channel,
            OpEntityKind::Chat => EntityKind::Chat,
            OpEntityKind::Project => EntityKind::Project,
            OpEntityKind::Thread => EntityKind::Thread,
            OpEntityKind::CalendarEvent => EntityKind::CalendarEvent,
            OpEntityKind::Initiative => EntityKind::Initiative,
        }
    }
}

impl ColumnKind {
    /// The engine's kind for a column holding values of `kind`; `options`
    /// are kept only for a select.
    pub fn of(kind: CastKind, options: Vec<SelectOption>) -> ColumnKind {
        match kind {
            CastKind::Text => ColumnKind::Text,
            CastKind::Number => ColumnKind::Number,
            CastKind::Boolean => ColumnKind::Boolean,
            CastKind::Date => ColumnKind::Date,
            CastKind::Link => ColumnKind::Link,
            CastKind::Select { multi } => ColumnKind::Select { multi, options },
            CastKind::Entity { target, multi } => ColumnKind::Entity {
                multi,
                target: target.into(),
            },
            CastKind::Relation => ColumnKind::Entity {
                multi: true,
                target: EntityKind::Row,
            },
        }
    }

    /// The column's values as the cast rule reads them.
    pub fn cast_kind(&self) -> CastKind {
        match self {
            ColumnKind::Text => CastKind::Text,
            ColumnKind::Number => CastKind::Number,
            ColumnKind::Boolean => CastKind::Boolean,
            ColumnKind::Date => CastKind::Date,
            ColumnKind::Link => CastKind::Link,
            ColumnKind::Select { multi, .. } => CastKind::Select { multi: *multi },
            ColumnKind::Entity { multi, target } => match OpEntityKind::try_from(*target) {
                Ok(target) => CastKind::Entity {
                    target,
                    multi: *multi,
                },
                Err(RelationTarget) => CastKind::Relation,
            },
        }
    }

    /// Whether a cell can hold several values.
    pub fn is_multi(&self) -> bool {
        matches!(
            self,
            ColumnKind::Select { multi: true, .. } | ColumnKind::Entity { multi: true, .. }
        )
    }

    /// How the kind reads in an error message.
    pub fn describe(&self) -> &'static str {
        self.into()
    }
}
