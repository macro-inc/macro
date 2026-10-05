//! The catalog a statement runs against: the viewer's databases mapped onto
//! the schema `database_sql::catalog::build` takes, as the browser maps them.

#[cfg(test)]
mod test;

use database_sql::catalog::{
    Catalog, Column, ColumnSchema, DatabaseSchema, EntityKind, OptionSchema, PlatformTable,
    PropertyType, Schema, TableSchema,
};
use databases::domain::catalog;
use databases::domain::models::{
    ColumnConfig, ColumnDetail, DatabaseDetail, DatabaseId, TableDetail, TableId,
};
use models_databases::OptionId;
use uuid::Uuid;

/// What one statement can see: the viewer's databases in detail, and the
/// catalog built from them for the statement's scope.
pub(crate) struct ViewerCatalog {
    pub(crate) databases: Vec<DatabaseDetail>,
    catalog: Catalog,
}

impl ViewerCatalog {
    /// The catalog a statement written from `scope` sees.
    pub(crate) fn new(databases: Vec<DatabaseDetail>, scope: Option<DatabaseId>) -> Self {
        let catalog = database_sql::catalog::build(&schema(&databases), scope);
        Self { databases, catalog }
    }

    /// The engine's catalog.
    pub(crate) fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    /// Whether the viewer can reach this database.
    pub(crate) fn has_database(&self, database_id: DatabaseId) -> bool {
        self.databases
            .iter()
            .any(|detail| detail.database.id == database_id)
    }

    /// A table with the database it belongs to.
    pub(crate) fn table(&self, table_id: TableId) -> Option<(&DatabaseDetail, &TableDetail)> {
        self.databases.iter().find_map(|database| {
            database
                .tables
                .iter()
                .find(|table| table.table.id == table_id)
                .map(|table| (database, table))
        })
    }

    /// The table the rows of `table`'s relation column `definition` belong
    /// to. A definition shared by several tables can link each elsewhere.
    pub(crate) fn related_table(&self, table: TableId, definition: Uuid) -> Option<TableId> {
        self.table(table)?
            .1
            .columns
            .iter()
            .find(|column| column.definition.definition.id == definition)
            .and_then(|column| match column.column.config {
                Some(ColumnConfig::Link { table_id, .. }) => Some(table_id),
                _ => None,
            })
    }

    /// The engine's view of a column, found by the definition reads key it
    /// by. A definition shared by several tables has one kind everywhere.
    pub(crate) fn column(&self, definition: Uuid) -> Option<&Column> {
        self.catalog
            .tables
            .iter()
            .flat_map(|table| &table.columns)
            .find(|column| column.id == definition)
    }
}

/// The databases as the schema the engine builds its catalog from, with the
/// people the viewer can see.
pub(crate) fn schema(databases: &[DatabaseDetail]) -> Schema {
    Schema {
        databases: databases
            .iter()
            .map(|detail| DatabaseSchema {
                id: detail.database.id,
                name: detail.database.name.clone(),
                tables: detail
                    .tables
                    .iter()
                    .map(|table| TableSchema {
                        id: table.table.id,
                        name: table.table.name.clone(),
                        columns: table.columns.iter().map(column_schema).collect(),
                    })
                    .collect(),
            })
            .collect(),
        platform: vec![PlatformTable::People],
    }
}

fn column_schema(column: &ColumnDetail) -> ColumnSchema {
    let definition = &column.definition.definition;
    ColumnSchema {
        id: column.column.id,
        definition: definition.id,
        name: column.name().to_string(),
        property: PropertyType {
            data_type: catalog::stored_data_type(definition.data_type),
            multi: definition.is_multi_select,
            entity_type: definition.specific_entity_type.map(|stored| {
                catalog::entity_kind(stored).map_or(EntityKind::Row, EntityKind::from)
            }),
            relation: column.column.is_relation(),
        },
        options: column
            .definition
            .property_options
            .iter()
            .map(|option| OptionSchema {
                id: OptionId::from_uuid(option.id),
                value: catalog::option_value(&option.value),
                order: option.display_order,
            })
            .collect(),
    }
}
