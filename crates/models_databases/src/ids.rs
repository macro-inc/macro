//! Identifiers of a database's parts.

#[cfg(test)]
mod test;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A UUID newtype per kind of part, so one kind of id never stands in for
/// another. On the wire and in every generated schema each is the plain
/// UUID string it wraps.
macro_rules! database_id {
    ($(#[$attribute:meta])* $name:ident) => {
        $(#[$attribute])*
        #[derive(
            Debug,
            Clone,
            Copy,
            PartialEq,
            Eq,
            Hash,
            PartialOrd,
            Ord,
            Serialize,
            Deserialize,
            utoipa::ToSchema,
            specta::Type,
        )]
        #[serde(transparent)]
        #[specta(transparent)]
        #[schema(value_type = Uuid)]
        pub struct $name(Uuid);

        // The UUID's own schema, inlined, so a tool schema reads as before.
        #[cfg(feature = "schema")]
        impl schemars::JsonSchema for $name {
            fn inline_schema() -> bool {
                <Uuid as schemars::JsonSchema>::inline_schema()
            }

            fn schema_name() -> std::borrow::Cow<'static, str> {
                <Uuid as schemars::JsonSchema>::schema_name()
            }

            fn schema_id() -> std::borrow::Cow<'static, str> {
                <Uuid as schemars::JsonSchema>::schema_id()
            }

            fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
                <Uuid as schemars::JsonSchema>::json_schema(generator)
            }
        }

        impl $name {
            /// A fresh, time-ordered (UUIDv7) id.
            pub fn new() -> Self {
                Self(macro_uuid::generate_uuid_v7())
            }

            /// The id a stored or received UUID names.
            pub const fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            /// The UUID, for storage and transport adapters.
            pub const fn as_uuid(&self) -> &Uuid {
                &self.0
            }

            /// The UUID, consuming the id.
            pub const fn into_uuid(self) -> Uuid {
                self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl From<Uuid> for $name {
            fn from(uuid: Uuid) -> Self {
                Self(uuid)
            }
        }

        impl From<$name> for Uuid {
            fn from(id: $name) -> Self {
                id.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;

            fn from_str(text: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(text).map(Self)
            }
        }
    };
}

database_id!(
    /// Identifier of reusable database storage. Its optional Macro entity uses
    /// the same identity, so existing routes and grants keep their IDs.
    DatabaseId
);
database_id!(
    /// Identifier of one table (tab) within a database.
    TableId
);
database_id!(
    /// Identifier of a column placement within a table.
    ColumnId
);
database_id!(
    /// Identifier of a row.
    RowId
);
database_id!(
    /// Identifier of an option of a select or tag column.
    OptionId
);
database_id!(
    /// Identifier of a saved view of a table.
    ViewId
);
database_id!(
    /// Identifier of a saved query.
    QueryId
);
database_id!(
    /// Identifier of a property definition, the type and options behind a
    /// column. The properties system mints and owns it.
    PropertyId
);

/// Monotonic per-table version, bumped once by every committed change to a
/// table's schema or rows. Schema edits name the version they were made
/// against, and change events carry the new one.
#[derive(
    utoipa::ToSchema,
    specta::Type,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
)]
// A version never nears 2^53, so TypeScript reads it as a plain number.
#[specta(type = f64)]
pub struct TableVersion(pub i64);

/// The change journal's id of one committed change: one version of one
/// table that a batch produced. Ids only grow, so a later change of a table
/// has a larger one.
#[derive(
    utoipa::ToSchema,
    specta::Type,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
)]
// An id never nears 2^53, so TypeScript reads it as a plain number.
#[specta(type = f64)]
pub struct ChangeId(pub i64);
