//! Stage two: bind the parsed AST to a [`Catalog`].
//!
//! Names become ids, literals become typed [`Value`]s, and every comparison,
//! aggregate and ordering is checked against the column it applies to. What
//! comes out is a query later stages can trust without looking at the catalog
//! again. Every failure is a [`ResolveError`] whose message quotes the names
//! the agent wrote.

mod error;
mod filter;
mod names;
mod select;
#[cfg(test)]
mod test;
mod write;

use chrono::{DateTime, Utc};
use uuid::Uuid;

pub use self::error::ResolveError;
pub use self::names::{ROW_ID, ROW_POSITION};
use crate::catalog::{Catalog, Table, TableSource};
use crate::parse::{self, Statement};
use models_databases::ColumnKind as OpColumnKind;
use models_databases::cast::{Cast, CastKind, Contents, cast};
use models_databases::{OptionId, TableId};

pub use crate::parse::{AggregateFunction, ComparisonOperator, Direction, JoinKind};

/// A statement bound to the catalog.
#[derive(Debug, Clone, PartialEq)]
pub enum Query {
    /// A read.
    Select(SelectQuery),
    /// Rows to create.
    Insert(InsertQuery),
    /// Cells to set on the rows a read finds.
    Update(UpdateQuery),
    /// The rows a read finds, to remove.
    Delete(DeleteQuery),
    /// A column's type to change.
    AlterColumnType(AlterColumnTypeQuery),
}

/// A `SELECT` with every name resolved and every comparison type-checked.
///
/// Columns are referred to by *key*, not by property definition id: one
/// definition can be bound to several of the joined tables, so a key names
/// a column of one relation. See [`column_key`].
#[derive(Debug, Clone, PartialEq)]
pub struct SelectQuery {
    /// `DISTINCT`: repeated result rows are dropped.
    pub distinct: bool,
    /// The tables read: the `FROM` table first, then each join's.
    pub relations: Vec<Relation>,
    /// The joins, in statement order; `joins[i]` brings in `relations[i + 1]`.
    pub joins: Vec<ResolvedJoin>,
    /// The select list; `*` has been expanded to every column.
    pub items: Vec<SelectItem>,
    /// The names select-list items were given with `AS`, by position.
    pub labels: Vec<(usize, String)>,
    /// The `WHERE` filter.
    pub where_: Option<Filter>,
    /// The `GROUP BY` column.
    pub group_by: Option<Uuid>,
    /// The `ORDER BY` keys, in order.
    pub order_by: Vec<Order>,
    /// `LIMIT`: at most this many result rows.
    pub limit: Option<u32>,
    /// `OFFSET`: skip this many result rows first.
    pub offset: Option<u32>,
    /// What every key the query mentions refers to.
    pub bindings: Vec<Binding>,
}

/// One table read by a `SELECT`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relation {
    /// The table.
    pub table: TableId,
    /// The alias its columns are qualified by.
    pub alias: String,
    /// Where its rows come from.
    pub source: TableSource,
}

/// A join, resolved: each `on` pair is (a key of an earlier relation, a key
/// of the joined relation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedJoin {
    /// The relation joined in.
    pub relation: usize,
    /// Inner or left.
    pub kind: JoinKind,
    /// The equalities, all of which must hold.
    pub on: Vec<(Uuid, Uuid)>,
}

/// What a key refers to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    /// The key.
    pub key: Uuid,
    /// The relation the column belongs to.
    pub relation: usize,
    /// The property definition; `None` for the row id.
    pub column: Option<Uuid>,
}

/// The key of a column: the definition id itself in the `FROM` table, so a
/// single-table query's keys are its definition ids, and a name derived from
/// it in each joined table.
pub fn column_key(relation: usize, column: Uuid) -> Uuid {
    if relation == 0 {
        column
    } else {
        Uuid::new_v5(&column, &[relation as u8])
    }
}

/// The key of a table's row id.
pub fn row_id_key(table: TableId) -> Uuid {
    Uuid::new_v5(table.as_uuid(), b"row_id")
}

/// The key of a table's row position.
pub fn row_position_key(table: TableId) -> Uuid {
    Uuid::new_v5(table.as_uuid(), b"row_position")
}

/// The stand-in column a key names in `table`: its row id or row position.
pub fn virtual_column(table: TableId, key: Uuid) -> Option<crate::catalog::Column> {
    names::virtual_columns(table)
        .into_iter()
        .find(|column| column.id == key)
}

impl SelectQuery {
    /// The `FROM` table.
    pub fn table(&self) -> TableId {
        self.relations[0].table
    }

    /// What a key refers to, if the query mentions it.
    pub fn binding(&self, key: Uuid) -> Option<&Binding> {
        binding(&self.bindings, key)
    }
}

/// What `key` refers to among `bindings`.
pub fn binding(bindings: &[Binding], key: Uuid) -> Option<&Binding> {
    bindings.iter().find(|binding| binding.key == key)
}

impl AsRef<Relation> for Relation {
    fn as_ref(&self) -> &Relation {
        self
    }
}

/// One entry of the select list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectItem {
    /// A column's value.
    Column(Uuid),
    /// An aggregate over a column, or over rows for `COUNT(*)`.
    Aggregate {
        /// Which aggregate.
        function: AggregateFunction,
        /// The column aggregated; `None` only for `COUNT(*)`.
        column: Option<Uuid>,
    },
}

/// A resolved `WHERE` condition.
#[derive(Debug, Clone, PartialEq)]
pub enum Filter {
    /// `column operator value`.
    Comparison {
        /// The column.
        column: Uuid,
        /// The operator.
        operator: ComparisonOperator,
        /// The value, typed for the column.
        value: Value,
    },
    /// `column [NOT] IN (values)`.
    In {
        /// The column.
        column: Uuid,
        /// The values, typed for the column.
        values: Vec<Value>,
        /// `NOT IN`.
        negated: bool,
    },
    /// `column [NOT] HAS value` on a multi-valued column.
    Has {
        /// The column.
        column: Uuid,
        /// The member tested.
        value: Value,
        /// `NOT HAS`.
        negated: bool,
    },
    /// `column IS [NOT] NULL`.
    IsNull {
        /// The column.
        column: Uuid,
        /// `IS NOT NULL`.
        negated: bool,
    },
    /// `column [NOT] LIKE pattern` on a text column.
    Like {
        /// The column.
        column: Uuid,
        /// The pattern, with SQL `%` and `_` wildcards.
        pattern: String,
        /// The character that makes the next pattern character literal.
        escape: Option<char>,
        /// `NOT LIKE`.
        negated: bool,
    },
    /// All must hold.
    And(Vec<Filter>),
    /// Any must hold.
    Or(Vec<Filter>),
}

/// A literal after it has been typed for the column it is compared to or
/// stored in.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// Text, on text and link columns.
    Text(String),
    /// A number.
    Number(f64),
    /// A checkbox state.
    Bool(bool),
    /// A date-time, parsed from an ISO 8601 date or date-time literal.
    Date(DateTime<Utc>),
    /// A select option, resolved from its label.
    Option(OptionId),
    /// An entity id such as `macro|sam@example.com`.
    Entity(String),
    /// Every option of a multi-select cell being written.
    Options(Vec<OptionId>),
    /// Every reference of a multi-valued entity cell being written.
    Entities(Vec<String>),
}

/// One `ORDER BY` key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    /// What is sorted on.
    pub key: OrderKey,
    /// The direction.
    pub direction: Direction,
}

/// What an `ORDER BY` key refers to after resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrderKey {
    /// A column key, selected or not.
    Column(Uuid),
    /// A 0-based index into the select list; positional keys and aggregates
    /// both resolve to this.
    Item(usize),
}

/// An `INSERT` with columns resolved and values typed.
#[derive(Debug, Clone, PartialEq)]
pub struct InsertQuery {
    /// The table written.
    pub table: TableId,
    /// One entry per row: the cells to set, in column-list order. A `NULL`
    /// literal is not a cell.
    pub rows: Vec<Vec<(Uuid, Value)>>,
}

/// An `UPDATE`: the read that finds its rows, and what each gets.
#[derive(Debug, Clone, PartialEq)]
pub struct UpdateQuery {
    /// The table written.
    pub table: TableId,
    /// Finds the rows: `row_id`, then every column an assignment copies.
    pub read: SelectQuery,
    /// The cells to set, in statement order.
    pub assignments: Vec<Assignment>,
}

/// One `SET column = …`.
#[derive(Debug, Clone, PartialEq)]
pub struct Assignment {
    /// The column's property definition.
    pub column: Uuid,
    /// What it becomes.
    pub value: Assigned,
}

/// What an assignment sets a cell to.
#[derive(Debug, Clone, PartialEq)]
pub enum Assigned {
    /// The same value on every row; `None` clears the cell.
    Value(Option<Value>),
    /// The row's own value of another column: the property definition, which
    /// the read selects.
    Column(Uuid),
}

/// A `DELETE`: the read that finds its rows.
#[derive(Debug, Clone, PartialEq)]
pub struct DeleteQuery {
    /// The table written.
    pub table: TableId,
    /// Finds the rows: `row_id` alone.
    pub read: SelectQuery,
}

/// An `ALTER COLUMN … TYPE` the cast rule allows for a column with values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlterColumnTypeQuery {
    /// The table.
    pub table: TableId,
    /// The column's property definition.
    pub column: Uuid,
    /// The type it becomes.
    pub to: OpColumnKind,
}

/// Bind a parsed statement to the catalog.
pub fn resolve(catalog: &Catalog, statement: Statement) -> Result<Query, ResolveError> {
    match statement {
        Statement::Select(select) => select::resolve(catalog, select).map(Query::Select),
        Statement::Insert(insert) => {
            let table = writable(names::table(catalog, &insert.table)?)?;
            write::resolve_insert(table, insert).map(Query::Insert)
        }
        Statement::Update(update) => {
            writable(names::table(catalog, &update.table)?)?;
            write::resolve_update(catalog, update).map(Query::Update)
        }
        Statement::AlterColumnType(alter) => {
            let table = writable(names::table(catalog, &alter.table)?)?;
            let column = names::column(table, &alter.column)?;
            // No data is read here, so the column is taken to hold values;
            // the writer knows better and lets an empty one take any type.
            if let Cast::Never(reason) = cast(
                column.kind.cast_kind(),
                CastKind::from(alter.to),
                Contents::Filled,
            ) {
                return Err(ResolveError::CastNever {
                    column: column.name.clone(),
                    to: alter.to.to_string(),
                    reason,
                });
            }
            Ok(Query::AlterColumnType(AlterColumnTypeQuery {
                table: table.id,
                column: column.id,
                to: alter.to,
            }))
        }
        Statement::Delete(delete) => {
            writable(names::table(catalog, &delete.table)?)?;
            write::resolve_delete(catalog, delete).map(Query::Delete)
        }
    }
}

/// A table a statement may write: a database's own, not a platform table.
fn writable(table: &Table) -> Result<&Table, ResolveError> {
    match table.source {
        TableSource::Database => Ok(table),
        TableSource::People => Err(ResolveError::ReadOnlyTable {
            table: names::qualified(table),
        }),
    }
}

/// Parse and resolve in one step.
pub fn compile(catalog: &Catalog, sql: &str) -> Result<Query, CompileError> {
    let statement = parse::parse(sql)?;
    Ok(resolve(catalog, statement)?)
}

/// Why a statement could not be compiled.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CompileError {
    /// The text was not a statement of the supported grammar.
    #[error(transparent)]
    Parse(#[from] parse::ParseError),
    /// The statement named something the catalog does not have, or used a
    /// column in a way its type does not allow.
    #[error(transparent)]
    Resolve(#[from] ResolveError),
}
