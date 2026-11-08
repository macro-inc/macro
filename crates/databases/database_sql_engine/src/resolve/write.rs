//! `INSERT`, `UPDATE` and `DELETE`: columns resolved once, every value typed
//! for its column, and the rows an update or delete changes found by a read.

use uuid::Uuid;

use crate::catalog::{Catalog, ColumnKind, EntityKind, Table};
use crate::parse::{
    ColumnRef, Condition, Delete, FromItem, Identifier, Insert, Item, Literal, Select, SelectList,
    SetValue, TableName, Update,
};

use super::names::ROW_ID;
use super::{
    Assigned, Assignment, Binding, DeleteQuery, InsertQuery, ResolveError, SelectItem, SelectQuery,
    UpdateQuery, column_key, filter, names, select,
};

pub fn resolve_insert(table: &Table, insert: Insert) -> Result<InsertQuery, ResolveError> {
    let mut columns = Vec::with_capacity(insert.columns.len());
    for name in &insert.columns {
        let column = stored_column(names::column(table, name)?)?;
        if columns
            .iter()
            .any(|seen: &&crate::catalog::Column| seen.id == column.id)
        {
            return Err(ResolveError::DuplicateColumn {
                column: column.name.clone(),
            });
        }
        columns.push(column);
    }

    let rows = insert
        .rows
        .into_iter()
        .map(|row| {
            row.into_iter()
                .zip(&columns)
                .filter(|(value, _)| *value != Literal::Null)
                .map(|(value, column)| Ok((column.id, filter::typed_cell(column, value)?)))
                .collect::<Result<Vec<_>, ResolveError>>()
        })
        .collect::<Result<_, _>>()?;

    Ok(InsertQuery {
        table: table.id,
        rows,
    })
}

pub fn resolve_update(catalog: &Catalog, update: Update) -> Result<UpdateQuery, ResolveError> {
    let mut read = rows_where(catalog, &update.table, update.where_)?;
    let table = names::table(catalog, &update.table)?;
    let mut assignments: Vec<Assignment> = Vec::with_capacity(update.assignments.len());
    for (name, value) in update.assignments {
        let column = stored_column(names::column(table, &name)?)?;
        if assignments.iter().any(|seen| seen.column == column.id) {
            return Err(ResolveError::DuplicateColumn {
                column: column.name.clone(),
            });
        }
        let value = match value {
            SetValue::Literal(Literal::Null) => Assigned::Value(None),
            SetValue::Literal(value) => Assigned::Value(Some(filter::typed_cell(column, value)?)),
            SetValue::Column(name) => {
                let source = names::column(table, &name)?;
                if family(&column.kind) != family(&source.kind) {
                    return Err(ResolveError::CopyKindMismatch {
                        column: column.name.clone(),
                        column_kind: column.kind.describe(),
                        copied: source.name.clone(),
                        copied_kind: source.kind.describe(),
                    });
                }
                select_column(&mut read, source.id);
                Assigned::Column(source.id)
            }
        };
        assignments.push(Assignment {
            column: column.id,
            value,
        });
    }
    Ok(UpdateQuery {
        table: table.id,
        read,
        assignments,
    })
}

/// The column, unless a formula computes its cells.
pub(super) fn stored_column(
    column: &crate::catalog::Column,
) -> Result<&crate::catalog::Column, ResolveError> {
    match column.formula {
        Some(_) => Err(ResolveError::DerivedColumn {
            column: column.name.clone(),
        }),
        None => Ok(column),
    }
}

pub fn resolve_delete(catalog: &Catalog, delete: Delete) -> Result<DeleteQuery, ResolveError> {
    let read = rows_where(catalog, &delete.table, delete.where_)?;
    Ok(DeleteQuery {
        table: read.table(),
        read,
    })
}

/// `SELECT row_id FROM table WHERE cond`: the rows a write changes.
fn rows_where(
    catalog: &Catalog,
    table: &TableName,
    where_: Condition,
) -> Result<SelectQuery, ResolveError> {
    select::resolve(
        catalog,
        Select {
            distinct: false,
            items: SelectList::Items(vec![Item::Column(ColumnRef {
                table: None,
                column: Identifier(ROW_ID.into()),
            })]),
            aliases: vec![],
            from: FromItem {
                table: table.clone(),
                alias: None,
            },
            joins: vec![],
            where_: Some(where_),
            group_by: None,
            order_by: vec![],
            limit: None,
            offset: None,
        },
    )
}

/// Add a column of the `FROM` table to the read's select list, once.
fn select_column(read: &mut SelectQuery, definition: Uuid) {
    let key = column_key(0, definition);
    if read.items.contains(&SelectItem::Column(key)) {
        return;
    }
    read.items.push(SelectItem::Column(key));
    if read.binding(key).is_none() {
        read.bindings.push(Binding {
            key,
            relation: 0,
            column: Some(definition),
        });
    }
}

/// What a column holds, for copying one into another: selects copy between
/// each other whatever their options, references only to the same target.
fn family(kind: &ColumnKind) -> (&'static str, Option<EntityKind>) {
    match kind {
        ColumnKind::Entity { target, .. } => ("entity", Some(*target)),
        other => (other.describe(), None),
    }
}
