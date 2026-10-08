//! The subset AST. Untyped and unresolved: names are [`Identifier`]s and
//! values are [`Literal`]s; binding them to a catalog is the next stage's
//! job. No spans: later stages report problems by quoting the identifier.

use std::fmt;

use models_databases::ColumnKind as OpColumnKind;

/// An identifier as written, quotes removed, case preserved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identifier(pub String);

/// One parsed statement.
#[derive(Debug, Clone, PartialEq)]
pub enum Statement {
    /// A `SELECT`.
    Select(Select),
    /// An `INSERT … VALUES`.
    Insert(Insert),
    /// An `UPDATE … SET … WHERE …`.
    Update(Update),
    /// A `DELETE FROM … WHERE …`.
    Delete(Delete),
    /// An `ALTER TABLE … ALTER COLUMN … TYPE …`.
    AlterColumnType(AlterColumnType),
}

/// `SELECT [DISTINCT] items FROM table [JOIN …] [WHERE] [GROUP BY] [ORDER BY]`.
#[derive(Debug, Clone, PartialEq)]
pub struct Select {
    /// `DISTINCT`: drop repeated result rows.
    pub distinct: bool,
    /// The select list.
    pub items: SelectList,
    /// `item AS name`: the select-list position and the name it goes by.
    pub aliases: Vec<(usize, Identifier)>,
    /// The table the `FROM` names.
    pub from: FromItem,
    /// The joined tables, in statement order.
    pub joins: Vec<Join>,
    /// The `WHERE` condition.
    pub where_: Option<Condition>,
    /// The `GROUP BY` column.
    pub group_by: Option<ColumnRef>,
    /// The `ORDER BY` keys, in order.
    pub order_by: Vec<OrderBy>,
    /// `LIMIT n`.
    pub limit: Option<u32>,
    /// `OFFSET n`.
    pub offset: Option<u32>,
}

/// What a `SELECT` lists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectList {
    /// `*`: every column of every table read.
    Star,
    /// The items written, in order.
    Items(Vec<Item>),
}

/// A table read, with the alias its columns are qualified by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FromItem {
    /// The table.
    pub table: TableName,
    /// `[AS] alias`; without one, the table name qualifies its columns.
    pub alias: Option<Identifier>,
}

/// `JOIN table ON left = right [AND left = right]…`.
#[derive(Debug, Clone, PartialEq)]
pub struct Join {
    /// Inner or left.
    pub kind: JoinKind,
    /// The table joined in.
    pub table: FromItem,
    /// The equalities the joined rows must satisfy, all of them.
    pub on: Vec<(ColumnRef, ColumnRef)>,
}

/// How unmatched rows are treated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinKind {
    /// Only rows with a match on both sides.
    Inner,
    /// Every row of the earlier tables, matched or not.
    Left,
}

/// A column as written: `column` or `alias.column`. The name `row_id` refers
/// to a table's row entity id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnRef {
    /// The alias qualifying the column, if any.
    pub table: Option<Identifier>,
    /// The column.
    pub column: Identifier,
}

/// `[database.]table`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableName {
    /// The database, when qualified.
    pub database: Option<Identifier>,
    /// The table.
    pub table: Identifier,
}

/// One entry of the select list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Item {
    /// A column.
    Column(ColumnRef),
    /// An aggregate call.
    Aggregate(Aggregate),
}

/// An aggregate call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aggregate {
    /// Which aggregate.
    pub function: AggregateFunction,
    /// The column aggregated; `None` only for `COUNT(*)`.
    pub argument: Option<ColumnRef>,
}

/// The aggregate functions; the string form is the name as written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
#[strum(serialize_all = "UPPERCASE")]
pub enum AggregateFunction {
    /// `COUNT`.
    Count,
    /// `SUM`.
    Sum,
    /// `AVG`.
    Avg,
    /// `MIN`.
    Min,
    /// `MAX`.
    Max,
}

/// A `WHERE` condition.
#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// `column operator value`.
    Comparison {
        /// The column.
        column: ColumnRef,
        /// The operator.
        operator: ComparisonOperator,
        /// The literal compared against.
        value: Literal,
    },
    /// `column [NOT] IN (values)`.
    In {
        /// The column.
        column: ColumnRef,
        /// The literals listed.
        values: Vec<Literal>,
        /// `NOT IN`.
        negated: bool,
    },
    /// `column [NOT] HAS value`: membership in a multi-valued column.
    Has {
        /// The column.
        column: ColumnRef,
        /// The member tested.
        value: Literal,
        /// `NOT HAS`.
        negated: bool,
    },
    /// `column IS [NOT] NULL`.
    IsNull {
        /// The column.
        column: ColumnRef,
        /// `IS NOT NULL`.
        negated: bool,
    },
    /// `column [NOT] LIKE pattern`.
    Like {
        /// The column.
        column: ColumnRef,
        /// The pattern, with SQL `%` and `_` wildcards.
        pattern: String,
        /// `ESCAPE 'c'`: the character that makes the next pattern character
        /// literal.
        escape: Option<char>,
        /// `NOT LIKE`.
        negated: bool,
    },
    /// Two or more conditions joined by `AND`.
    And(Vec<Condition>),
    /// Two or more conditions joined by `OR`.
    Or(Vec<Condition>),
}

/// A comparison operator; the string form is the symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
pub enum ComparisonOperator {
    /// `=`.
    #[strum(serialize = "=")]
    Equal,
    /// `!=` or `<>`.
    #[strum(serialize = "!=")]
    NotEqual,
    /// `<`.
    #[strum(serialize = "<")]
    Less,
    /// `<=`.
    #[strum(serialize = "<=")]
    LessOrEqual,
    /// `>`.
    #[strum(serialize = ">")]
    Greater,
    /// `>=`.
    #[strum(serialize = ">=")]
    GreaterOrEqual,
}

/// A literal value.
#[derive(Debug, Clone, PartialEq)]
pub enum Literal {
    /// `'text'`.
    Text(String),
    /// A number.
    Number(f64),
    /// `TRUE` or `FALSE`.
    Boolean(bool),
    /// `NULL`.
    Null,
    /// `[value, …]`: several values for a multi-valued cell. Only in
    /// `INSERT` rows and `UPDATE` assignments.
    List(Vec<Literal>),
}

/// One `ORDER BY` key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderBy {
    /// What is sorted on.
    pub key: OrderKey,
    /// The direction; `ASC` when unspecified.
    pub direction: Direction,
}

/// What an `ORDER BY` key refers to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrderKey {
    /// A column.
    Column(ColumnRef),
    /// An aggregate that also appears in the select list.
    Aggregate(Aggregate),
    /// A 1-based position in the select list.
    Position(u32),
}

/// A sort direction; the string form is the keyword.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Direction {
    /// Ascending.
    #[strum(serialize = "ASC")]
    Ascending,
    /// Descending.
    #[strum(serialize = "DESC")]
    Descending,
}

/// `INSERT INTO table (columns) VALUES rows`.
#[derive(Debug, Clone, PartialEq)]
pub struct Insert {
    /// The table written.
    pub table: TableName,
    /// The columns named, in order; empty for `DEFAULT VALUES`.
    pub columns: Vec<Identifier>,
    /// The rows; every row has exactly `columns.len()` values. `DEFAULT
    /// VALUES` is one empty row.
    pub rows: Vec<Vec<Literal>>,
}

/// `UPDATE table SET column = value, … WHERE condition`: every row the
/// condition matches.
#[derive(Debug, Clone, PartialEq)]
pub struct Update {
    /// The table written.
    pub table: TableName,
    /// The cells set, in order.
    pub assignments: Vec<(Identifier, SetValue)>,
    /// Which rows.
    pub where_: Condition,
}

/// What an `UPDATE` sets a cell to.
#[derive(Debug, Clone, PartialEq)]
pub enum SetValue {
    /// A value; `NULL` clears the cell.
    Literal(Literal),
    /// Another column of the same row: each row gets its own value.
    Column(Identifier),
}

/// `DELETE FROM table WHERE condition`: every row the condition matches.
#[derive(Debug, Clone, PartialEq)]
pub struct Delete {
    /// The table written.
    pub table: TableName,
    /// Which rows.
    pub where_: Condition,
}

/// `ALTER TABLE table ALTER [COLUMN] column TYPE type`: change one column's
/// type, converting its values; a value that does not fit refuses it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlterColumnType {
    /// The table whose column changes.
    pub table: TableName,
    /// The column.
    pub column: Identifier,
    /// The type it becomes.
    pub to: OpColumnKind,
}

impl AggregateFunction {
    /// The function as written.
    pub fn name(self) -> &'static str {
        self.into()
    }
}

impl ComparisonOperator {
    /// The operator as written.
    pub fn symbol(self) -> &'static str {
        self.into()
    }
}

impl fmt::Display for Aggregate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.argument {
            Some(column) => write!(formatter, "{}({column})", self.function.name()),
            None => write!(formatter, "{}(*)", self.function.name()),
        }
    }
}

impl fmt::Display for ColumnRef {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.table {
            Some(table) => write!(formatter, "{}.{}", table.0, self.column.0),
            None => write!(formatter, "{}", self.column.0),
        }
    }
}
