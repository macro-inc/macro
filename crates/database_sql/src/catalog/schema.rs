//! The one catalog builder. The server and the browser each describe the
//! databases a viewer can see as a [`Schema`], in the terms the properties
//! system stores them in, and [`build`] makes the [`Catalog`] from it, so a
//! statement names the same tables and columns wherever it runs.

#[cfg(test)]
mod test;

use models_databases::EntityKind as OpEntityKind;
use models_databases::property::stored_cast_kind;
pub use models_databases::property::{DataType, OptionValue};
use models_databases::{ColumnId, DatabaseId, OptionId, TableId};
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use super::{
    Catalog, Column, ColumnKind, EntityKind, RelationTarget, SelectOption, Table, TableSource,
};

/// What a catalog is built from: the viewer's databases, and the platform
/// tables to add.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    /// The databases, in the order their tables are listed.
    pub databases: Vec<DatabaseSchema>,
    /// The platform tables the caller can read.
    #[serde(default)]
    pub platform: Vec<PlatformTable>,
}

/// One database and its tables, in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSchema {
    /// The database id.
    pub id: DatabaseId,
    /// Its name, as users name it.
    pub name: String,
    /// Its tables.
    pub tables: Vec<TableSchema>,
}

/// One table and its columns, in display order. Derived columns (lookups)
/// are left out: they have no cells.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableSchema {
    /// The table id.
    pub id: TableId,
    /// Its name.
    pub name: String,
    /// Its columns.
    pub columns: Vec<ColumnSchema>,
}

/// One column placement and the property definition behind it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSchema {
    /// The placement.
    pub id: ColumnId,
    /// The property definition.
    pub definition: Uuid,
    /// The name it goes by: the placement's own, else the definition's.
    pub name: String,
    /// What it holds.
    pub property: PropertyType,
    /// The definition's options, in any order.
    pub options: Vec<OptionSchema>,
}

/// A column's type as the properties system stores it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PropertyType {
    /// The property type.
    pub data_type: DataType,
    /// Whether the definition holds several values.
    pub multi: bool,
    /// What a reference points at; people when unset.
    pub entity_type: Option<EntityKind>,
    /// Whether the placement relates rows of another table.
    pub relation: bool,
}

/// One option of a select definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OptionSchema {
    /// The option id.
    pub id: OptionId,
    /// Its value.
    pub value: OptionValue,
    /// Where it sorts among the definition's options.
    pub order: i32,
}

/// A table every viewer has, whatever databases they can see.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PlatformTable {
    /// `macro.people`.
    People,
}

impl PropertyType {
    /// The engine's kind for a column of this type, with these options.
    pub fn kind(&self, options: Vec<SelectOption>) -> ColumnKind {
        let target = self.entity_type.map(OpEntityKind::try_from);
        let relation = self.relation || matches!(target, Some(Err(RelationTarget)));
        let cast = stored_cast_kind(
            self.data_type,
            self.multi,
            target.and_then(Result::ok),
            relation,
        );
        ColumnKind::of(cast, options)
    }
}

impl ColumnSchema {
    /// The engine's kind for the column, options labeled in display order.
    pub fn kind(&self) -> ColumnKind {
        let mut options: Vec<&OptionSchema> = self.options.iter().collect();
        options.sort_by_key(|option| option.order);
        self.property.kind(
            options
                .into_iter()
                .map(|option| SelectOption {
                    id: option.id,
                    label: option.value.label(),
                })
                .collect(),
        )
    }
}

/// The catalog a statement run from `scope` names tables in. Scoped tables
/// take precedence for unqualified names. A table of another database whose
/// database and table names both match one of the scoped database's,
/// case-insensitively as the engine matches, is left out: the scoped table
/// also wins when the statement qualifies that name.
pub fn build(schema: &Schema, scope: Option<DatabaseId>) -> Catalog {
    let qualified = |database: &str, table: &str| (database.to_lowercase(), table.to_lowercase());
    let scoped: Vec<(String, String)> = schema
        .databases
        .iter()
        .filter(|database| Some(database.id) == scope)
        .flat_map(|database| {
            database
                .tables
                .iter()
                .map(|table| qualified(&database.name, &table.name))
        })
        .collect();
    let mut tables: Vec<Table> = schema
        .databases
        .iter()
        .flat_map(|database| database.tables.iter().map(move |table| (database, table)))
        .filter(|(database, table)| {
            Some(database.id) == scope || !scoped.contains(&qualified(&database.name, &table.name))
        })
        .map(|(database, table)| Table {
            id: table.id,
            database_id: database.id,
            database: database.name.clone(),
            name: table.name.clone(),
            columns: table
                .columns
                .iter()
                .map(|column| Column {
                    id: column.definition,
                    placement: column.id,
                    name: column.name.clone(),
                    kind: column.kind(),
                })
                .collect(),
            source: TableSource::Database,
        })
        .collect();
    tables.extend(
        schema
            .platform
            .iter()
            .map(|table| match table {
                PlatformTable::People => super::people_table(),
            })
            .filter(|table| !scoped.contains(&qualified(&table.database, &table.name))),
    );
    Catalog { tables, scope }
}
