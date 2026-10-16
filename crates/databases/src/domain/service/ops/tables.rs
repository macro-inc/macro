//! The table ops: adding, renaming, removing and ordering a database's
//! tables, each checked against what earlier ops leave.

use std::collections::HashSet;
use std::sync::Arc;

use models_databases::TakenId;
use models_databases::position::{key_between, keys_between};

use super::{Planner, refuse, refuse_taken};
use crate::domain::catalog::StorageTable;
use crate::domain::models::{
    ColumnConfig, DatabaseError, SchemaError, Table, TableId, TableVersion, Write,
};
use crate::domain::service::{same_name, validate_name};

impl Planner {
    pub(super) fn create_table(
        &mut self,
        index: usize,
        id: TableId,
        name: &str,
    ) -> Result<Write, DatabaseError> {
        if self.entries.iter().any(|entry| entry.table.id == id) {
            return Err(refuse_taken(index, TakenId::Table(id)));
        }
        let name = self.table_name(index, None, name)?;
        // The store places the table after the others under the database's
        // lock; this place only orders the batch's later reads.
        let position = key_between(self.entries.last().map(|entry| &entry.table.position), None)
            .map_err(|error| refuse(index, None, None, error.to_string()))?;
        self.entries.push(Arc::new(StorageTable {
            table: Table {
                id,
                database_id: self.database_id,
                name: name.clone(),
                position,
                version: TableVersion(0),
            },
            columns: Vec::new(),
            views: Vec::new(),
        }));
        self.created_tables.insert(id);
        Ok(Write::CreateTable { table_id: id, name })
    }

    pub(super) fn rename_table(
        &mut self,
        index: usize,
        entry: &StorageTable,
        name: &str,
        previous_name: Option<&str>,
    ) -> Result<Write, DatabaseError> {
        let table = entry.table.id;
        let current = entry.table.name.clone();
        let name = validate_name(name).map_err(|error| table_refusal(index, error))?;
        // A retry after a lost response is already complete.
        if current == name {
            return Ok(Write::Unchanged { table_id: table });
        }
        if previous_name.is_some_and(|previous| previous != current) {
            return Err(refuse(
                index,
                None,
                None,
                SchemaError::TableRenameConflict.to_string(),
            ));
        }
        let name = self.table_name(index, Some(table), &name)?;
        if let Some(entry) = self.entry_mut(table) {
            entry.table.name = name.clone();
        }
        Ok(Write::RenameTable {
            table_id: table,
            from: current,
            name,
        })
    }

    pub(super) fn delete_table(
        &mut self,
        index: usize,
        entry: &StorageTable,
    ) -> Result<Write, DatabaseError> {
        let table = entry.table.id;
        if self.entries.len() == 1 {
            return Err(refuse(
                index,
                None,
                None,
                SchemaError::LastTable.to_string(),
            ));
        }
        // A relation into the table would be left holding ids of rows that
        // no longer exist.
        for other in self.entries.iter().filter(|other| other.table.id != table) {
            if let Some(relation) = other.columns.iter().find(|column| {
                matches!(
                    column.column.config,
                    Some(ColumnConfig::Link { table_id, .. }) if table_id == table
                )
            }) {
                return Err(refuse(
                    index,
                    None,
                    None,
                    SchemaError::TableIsRelated {
                        column: relation.name().to_owned(),
                        source_table: other.table.name.clone(),
                        table: entry.table.name.clone(),
                    }
                    .to_string(),
                ));
            }
        }
        self.entries.retain(|other| other.table.id != table);
        self.views.remove(&table);
        Ok(Write::DeleteTable {
            table_id: table,
            version: entry.table.version,
        })
    }

    pub(super) fn order_tables(
        &mut self,
        index: usize,
        order: &[TableId],
    ) -> Result<Write, DatabaseError> {
        let current: HashSet<TableId> = self.entries.iter().map(|entry| entry.table.id).collect();
        let named: HashSet<TableId> = order.iter().copied().collect();
        if named.len() != order.len() || named != current {
            return Err(refuse(
                index,
                None,
                None,
                SchemaError::IncompleteTableOrder.to_string(),
            ));
        }
        let positions = keys_between(None, None, order.len())
            .map_err(|error| refuse(index, None, None, error.to_string()))?;
        for (table, position) in order.iter().zip(&positions) {
            if let Some(entry) = self.entry_mut(*table) {
                entry.table.position = position.clone();
            }
        }
        self.entries
            .sort_by(|left, right| left.table.position.cmp(&right.table.position));
        Ok(Write::OrderTables {
            tables: order.to_vec(),
            positions,
        })
    }

    /// A table's name, checked to be valid and unique among the database's
    /// other tables.
    fn table_name(
        &self,
        index: usize,
        table: Option<TableId>,
        name: &str,
    ) -> Result<String, DatabaseError> {
        let name = validate_name(name).map_err(|error| table_refusal(index, error))?;
        if self
            .entries
            .iter()
            .any(|other| Some(other.table.id) != table && same_name(&other.table.name, &name))
        {
            return Err(refuse(
                index,
                None,
                None,
                SchemaError::TableNameTaken { name }.to_string(),
            ));
        }
        Ok(name)
    }
}

/// A refused table name as the refusal of op `index`.
fn table_refusal(index: usize, error: DatabaseError) -> DatabaseError {
    match error {
        DatabaseError::InvalidSchemaOperation(reason) => {
            refuse(index, None, None, reason.to_string())
        }
        other => other,
    }
}
