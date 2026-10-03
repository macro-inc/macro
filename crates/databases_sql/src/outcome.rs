//! What a statement did, shaped for agents and the chat that shows them:
//! typed cells with what renders them, versions read and written, and changes.

use std::collections::HashMap;

use database_sql::catalog::{ColumnKind, EntityKind, SelectOption};
use database_sql::fold::Cell;
use database_sql::resolve::{Query, SelectItem};
use database_sql::run::{Outcome, OutcomeKind};
use databases::domain::models::{ColumnId, RowId, TableId, TableVersion};
use serde::Serialize;

use crate::catalog::ViewerCatalog;
use crate::service::SqlError;

/// The answer to one statement.
#[derive(Debug, Clone, PartialEq)]
pub struct SqlOutcome {
    /// The rows a `SELECT` returned; `None` for a write.
    pub result: Option<ResultSet>,
    /// How many rows a write changed.
    pub changes_applied: usize,
    /// The rows an `INSERT` created, in statement order.
    pub inserted_row_ids: Vec<RowId>,
    /// The new version of every table written.
    pub new_versions: HashMap<TableId, TableVersion>,
    /// The version of every table read, for a follow-up write to guard on.
    pub read_versions: HashMap<TableId, TableVersion>,
    /// Every table the statement read, when any read hit the engine's row
    /// cap: the engine reports the cap per statement, so aggregates over any
    /// of them may be partial.
    pub truncated_tables: Vec<String>,
    /// What kind of statement ran, and what it wrote.
    pub statement: SqlStatement,
}

/// The statement that ran: a read, or the table (and for a type change, the
/// column) it wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SqlStatement {
    /// A committed schema command. IDs remain available even without a follow-up read.
    Schema {
        /// Owning database.
        database_id: models_databases::DatabaseId,
        /// What changed and how to read the resulting schema.
        summary: String,
    },
    /// A `SELECT`.
    Select,
    /// An `INSERT`.
    Insert {
        /// The table written.
        table_id: TableId,
        /// Its name.
        table_name: String,
    },
    /// An `UPDATE`.
    Update {
        /// The table written.
        table_id: TableId,
        /// Its name.
        table_name: String,
    },
    /// A `DELETE`.
    Delete {
        /// The table written.
        table_id: TableId,
        /// Its name.
        table_name: String,
    },
    /// An `ALTER COLUMN … TYPE`.
    AlterColumnType {
        /// The table.
        table_id: TableId,
        /// Its name.
        table_name: String,
        /// The column placement; its id survives the change.
        column_id: ColumnId,
        /// The column's name.
        column_name: String,
        /// The type it became, as SQL spells it, e.g. `select[]`.
        to: String,
    },
}

/// A `SELECT`'s rows, as the engine's typed cells.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ResultSet {
    /// The columns, in select-list order.
    pub columns: Vec<ResultColumn>,
    /// One cell per column per row; `null` is an empty cell.
    pub rows: Vec<Vec<Option<Cell>>>,
    /// For a row-shaped result, the id of the row behind each result row;
    /// empty for an aggregate.
    pub row_ids: Vec<RowId>,
}

/// One result column, with what its cells mean.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    /// The name or alias the statement gave it.
    pub name: String,
    /// What its cells hold.
    pub kind: OutcomeKind,
    /// For a select column, its options: its cells hold their ids.
    // `default` is what marks the field optional in the tool's JSON Schema.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SelectOption>,
    /// For an entity column, what its ids point at; `DATABASE_ROW` for a
    /// relation, whose ids are rows of another table.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<EntityKind>,
    /// For a relation, the table its rows belong to; for `row_id`, the
    /// table read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_table: Option<TableId>,
}

/// The engine's outcome for `query` in the viewer's terms.
pub(crate) fn shape(
    catalog: &ViewerCatalog,
    query: &Query,
    outcome: &Outcome,
    new_versions: HashMap<TableId, TableVersion>,
) -> Result<SqlOutcome, SqlError> {
    let read_versions = outcome
        .read_tables
        .iter()
        .filter_map(|table| {
            catalog
                .table(*table)
                .map(|(_, detail)| (*table, detail.table.version))
        })
        .collect();
    let truncated_tables = if outcome.truncated {
        outcome
            .read_tables
            .iter()
            .filter_map(|table| catalog.table(*table))
            .map(|(_, detail)| detail.table.name.clone())
            .collect()
    } else {
        Vec::new()
    };
    Ok(SqlOutcome {
        result: result_set(catalog, query, outcome),
        changes_applied: outcome.changes_applied as usize,
        inserted_row_ids: outcome.inserted_row_ids.clone(),
        new_versions,
        read_versions,
        truncated_tables,
        statement: statement(catalog, query, outcome)?,
    })
}

/// What `query` was, naming what it wrote from the catalog it compiled
/// against.
fn statement(
    catalog: &ViewerCatalog,
    query: &Query,
    outcome: &Outcome,
) -> Result<SqlStatement, SqlError> {
    let table_name = |table_id: TableId| {
        catalog
            .table(table_id)
            .map(|(_, detail)| detail.table.name.clone())
            .ok_or(SqlError::WrittenTableNotInCatalog { table_id })
    };
    Ok(match query {
        Query::Select(_) => SqlStatement::Select,
        Query::Insert(insert) => SqlStatement::Insert {
            table_id: insert.table,
            table_name: table_name(insert.table)?,
        },
        Query::Update(update) => SqlStatement::Update {
            table_id: update.table,
            table_name: table_name(update.table)?,
        },
        Query::Delete(delete) => SqlStatement::Delete {
            table_id: delete.table,
            table_name: table_name(delete.table)?,
        },
        Query::AlterColumnType(_) => {
            let altered = outcome
                .altered_column
                .as_ref()
                .ok_or(SqlError::AlterWithoutAlteredColumn)?;
            let (_, table) =
                catalog
                    .table(altered.table)
                    .ok_or(SqlError::WrittenTableNotInCatalog {
                        table_id: altered.table,
                    })?;
            let column = table
                .columns
                .iter()
                .find(|column| column.definition.definition.id == altered.column)
                .ok_or(SqlError::AlteredColumnNotInCatalog {
                    table_id: altered.table,
                    definition: altered.column,
                })?;
            SqlStatement::AlterColumnType {
                table_id: altered.table,
                table_name: table.table.name.clone(),
                column_id: column.column.id,
                column_name: column.name().to_string(),
                to: altered.to.clone(),
            }
        }
    })
}

fn result_set(catalog: &ViewerCatalog, query: &Query, outcome: &Outcome) -> Option<ResultSet> {
    if outcome.columns.is_empty() {
        return None;
    }
    // The table behind a result column: its select item's relation.
    let table_of = |index: usize| -> Option<TableId> {
        let Query::Select(select) = query else {
            return None;
        };
        let SelectItem::Column(key) = select.items.get(index)? else {
            return None;
        };
        Some(select.relations[select.binding(*key)?.relation].table)
    };
    let row_shaped = outcome.row_ids.len() == outcome.rows.len();
    Some(ResultSet {
        columns: outcome
            .columns
            .iter()
            .enumerate()
            .map(|(index, column)| {
                let kind = column
                    .column
                    .and_then(|definition| catalog.column(definition))
                    .map(|column| &column.kind);
                ResultColumn {
                    name: column.name.clone(),
                    kind: column.kind,
                    options: match (column.kind, kind) {
                        (OutcomeKind::Select, Some(ColumnKind::Select { options, .. })) => {
                            options.clone()
                        }
                        _ => Vec::new(),
                    },
                    target: match (column.kind, kind) {
                        (OutcomeKind::Entity, Some(ColumnKind::Entity { target, .. })) => {
                            Some(*target)
                        }
                        _ => None,
                    },
                    related_table: match (column.kind, kind, column.column) {
                        (
                            OutcomeKind::Entity,
                            Some(ColumnKind::Entity {
                                target: EntityKind::Row,
                                ..
                            }),
                            Some(definition),
                        ) => table_of(index)
                            .and_then(|table| catalog.related_table(table, definition)),
                        (OutcomeKind::Row, _, _) => column.table,
                        _ => None,
                    },
                }
            })
            .collect(),
        rows: outcome.rows.clone(),
        row_ids: if row_shaped {
            outcome.row_ids.clone()
        } else {
            Vec::new()
        },
    })
}
