//! Identifiers of a Macro database's parts: the database itself, its tables,
//! columns, rows, select options, saved views and queries, and the property
//! definitions behind columns.
//!
//! `models_databases` re-exports them; they live here so a crate that only
//! names a database or table does not depend on the whole write vocabulary.

#![deny(missing_docs)]

#[cfg(test)]
mod test;

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
