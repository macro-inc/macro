//! Typed views on the engine: a view compiles straight to the
//! [`SelectQuery`](crate::resolve::SelectQuery) its SQL would resolve to,
//! and lays its rows out as a board.

mod board;
mod compile;

use models_databases::ColumnId;
use models_databases::views::{DatabaseView, SchemaColumn, ViewProblem, check};

use crate::catalog::{Catalog, Column, ColumnKind, Table};

pub use board::{Board, BoardLane, board};
pub use compile::{compile_table_query, compile_view};

/// The view's table, once the view checks out against it.
fn checked_table<'catalog>(
    view: &DatabaseView,
    catalog: &'catalog Catalog,
) -> Result<&'catalog Table, ViewProblem> {
    let table = catalog
        .tables
        .iter()
        .find(|table| table.id == view.table_id)
        .ok_or(ViewProblem::UnknownTable {
            table: view.table_id,
        })?;
    let columns: Vec<SchemaColumn> = table.columns.iter().map(schema_column).collect();
    check(&view.query, &view.layout, &columns)?;
    Ok(table)
}

fn schema_column(column: &Column) -> SchemaColumn {
    let options = match &column.kind {
        ColumnKind::Select { options, .. } => options.iter().map(|option| option.id).collect(),
        _ => Vec::new(),
    };
    SchemaColumn::new(
        column.placement,
        column.name.clone(),
        column.kind.cast_kind(),
        column.kind.is_multi(),
        options,
    )
}

/// The column a checked view names by placement.
fn placed(table: &Table, placement: ColumnId) -> &Column {
    table
        .columns
        .iter()
        .find(|column| column.placement == placement)
        .expect("the view was checked against this table")
}
