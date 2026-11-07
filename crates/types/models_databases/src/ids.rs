//! Identifiers of a database's parts.

#[cfg(test)]
mod test;

use serde::{Deserialize, Serialize};

// A UUID newtype per kind of part, so one kind of id never stands in for
// another. On the wire and in every generated schema each is the plain UUID
// string it wraps.
macro_rules! database_id {
    ($(#[$attribute:meta])* $name:ident) => {
        id_newtype::uuid_id!(
            $(#[$attribute])*
            #[specta(transparent)]
            #[schema(value_type = Uuid)]
            pub $name;
            derive_unchecked(utoipa::ToSchema, specta::Type)
        );

        // The UUID's own schema, inlined, so a tool schema reads as before.
        #[cfg(feature = "schema")]
        impl schemars::JsonSchema for $name {
            fn inline_schema() -> bool {
                <uuid::Uuid as schemars::JsonSchema>::inline_schema()
            }

            fn schema_name() -> std::borrow::Cow<'static, str> {
                <uuid::Uuid as schemars::JsonSchema>::schema_name()
            }

            fn schema_id() -> std::borrow::Cow<'static, str> {
                <uuid::Uuid as schemars::JsonSchema>::schema_id()
            }

            fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
                <uuid::Uuid as schemars::JsonSchema>::json_schema(generator)
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
