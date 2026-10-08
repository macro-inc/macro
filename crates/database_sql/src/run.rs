//! The whole pipeline in one call: [`run`] compiles a statement, drives an
//! [`Engine`] through a [`RowSource`] for its reads and an [`OpsSink`] for its
//! writes, and answers with an [`Outcome`].
//!
//! The source and sink are the only I/O; everything else is pure. Paging
//! and the row cap live in the engine rather than in the source so a fake
//! source can prove them.

#[cfg(test)]
mod test;

use std::future::Future;

use maybe_send::MaybeSend;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use models_databases::views::ViewProblem;
use models_databases::{
    ColumnResult, DatabaseId, DatabaseOp, OpResult, RowId, RowsResult, TableId, TableResult,
    ViewResult,
};

use crate::catalog::{Catalog, ColumnKind};
use crate::engine::{Engine, Step};
use crate::fold::{Bin, Row, Table};
use crate::parse::ParseError;
use crate::resolve::{
    AggregateFunction, Binding, CompileError, Relation, ResolveError, SelectItem, SelectQuery,
    binding, row_id_key,
};
use crate::split::{GqlQuery, column_of, virtual_column_of};

/// The most rows one statement reads before the fold. Past it the answer
/// is still returned, marked truncated, so aggregates are visibly partial
/// rather than silently wrong.
pub const ROW_CAP: usize = 20_000;

/// The most rows asked for in one page.
pub const PAGE_LIMIT: usize = 500;

/// One page of rows from the server.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    /// The rows, carrying at least the columns asked for.
    pub rows: Vec<Row>,
    /// The cursor for the next page, if there is one.
    pub next: Option<String>,
}

/// Where rows come from: the Soup GraphQL API on the server, the normalized
/// cache in the browser.
pub trait RowSource {
    /// Why the source could not answer.
    type Error: std::error::Error + MaybeSend + 'static;

    /// One page of the query, from `cursor` (the start when `None`), at most
    /// `limit` rows. `needs` names the columns the rows must carry.
    fn page(
        &self,
        query: &GqlQuery,
        needs: &[Uuid],
        cursor: Option<String>,
        limit: usize,
    ) -> impl Future<Output = Result<Page, Self::Error>> + MaybeSend;

    /// The bins of a `GqlQuery::GroupSoup`.
    fn bins(
        &self,
        query: &GqlQuery,
    ) -> impl Future<Output = Result<Vec<Bin>, Self::Error>> + MaybeSend;
}

/// Where writes go: a statement's ops, applied together to one database.
pub trait OpsSink {
    /// Why a write did not land.
    type Error: std::error::Error + MaybeSend + 'static;

    /// Apply `ops` to `database`; one result per op, in order.
    fn apply(
        &self,
        database: DatabaseId,
        ops: Vec<DatabaseOp>,
    ) -> impl Future<Output = Result<Vec<OpResult>, Self::Error>> + MaybeSend;
}

/// Why [`run`] did not produce an outcome: the engine refused the
/// statement, or its source or sink failed.
#[derive(Debug, PartialEq, thiserror::Error)]
pub enum RunFailure<SourceFailure, WriteFailure> {
    /// The engine refused the statement or what it was fed.
    #[error(transparent)]
    Engine(#[from] RunError),
    /// The source could not answer a read.
    #[error("could not read rows")]
    Source(#[source] SourceFailure),
    /// The sink did not apply the statement's ops.
    #[error(transparent)]
    Write(WriteFailure),
}

/// Why a statement did not run, as one typed union: each failure is a
/// value the browser reads by its `stage` (and, for resolution, `kind`), and
/// its `Display` text is what an agent reads.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Type)]
#[serde(
    tag = "stage",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunError {
    /// The text was not a statement of the supported grammar.
    #[error(transparent)]
    Parse(ParseError),
    /// The statement named something the catalog does not have, or used a
    /// column in a way its type does not allow.
    #[error(transparent)]
    Resolve(ResolveError),
    /// A view does not fit the table it shows.
    #[error(transparent)]
    View(ViewProblem),
    /// An `UPDATE` or `DELETE` named a row by id that the table does not
    /// have.
    #[error("row {position}: no row {row} in this table")]
    NoSuchRow {
        /// Where the row is named in the statement's list of ids, from 1.
        #[specta(type = u32)]
        position: usize,
        /// The row.
        row: RowId,
    },
    /// An `UPDATE` or `DELETE` matched more rows than a statement reads.
    #[error("the WHERE matches more than {limit} rows; narrow it and run the statement again")]
    TooManyRows {
        /// The most rows a statement reads.
        #[specta(type = u32)]
        limit: usize,
    },
    /// A feed answered the outstanding request with the wrong kind of
    /// answer.
    #[error("request {request} wants {expected}, but {fed} was fed")]
    WrongAnswer {
        /// The outstanding request.
        request: u32,
        /// What it asked for.
        expected: Answer,
        /// What was fed.
        fed: Answer,
    },
    /// Bins were folded for a statement that counting groups does not
    /// answer.
    #[error("the statement is not answered by counting groups")]
    NotAnsweredByBins,
    /// The sink answered a different number of results than ops sent.
    #[error("one op was sent, but {received} results came back")]
    OpResultCount {
        /// The results that came back.
        #[specta(type = u32)]
        received: usize,
    },
    /// The sink answered an op with a result of another kind.
    #[error("{sent} was sent, but {received} came back")]
    UnexpectedOpResult {
        /// The op sent.
        sent: SentOp,
        /// The result that came back.
        received: OpResultKind,
    },
    /// A feed quoted a request the engine is not waiting on.
    #[error("fed request {fed}, but request {expected} is outstanding")]
    WrongRequest {
        /// The outstanding request.
        expected: u32,
        /// The id fed.
        fed: u32,
    },
    /// A feed arrived when nothing was outstanding.
    #[error("fed request {fed}, but nothing is outstanding")]
    NothingOutstanding {
        /// The id fed.
        fed: u32,
    },
    /// A value handed to the engine is not the shape it reads.
    #[error("{what} is not readable: {message}")]
    Unreadable {
        /// What was handed in: the catalog, a page, the bins, ….
        what: Input,
        /// Why it could not be read.
        message: String,
    },
    /// A value the engine hands back could not be written out.
    #[error("the engine's answer could not be written out: {message}")]
    Unwritable {
        /// Why it could not be written.
        message: String,
    },
    /// The first step was asked for twice.
    #[error("the query has already started")]
    AlreadyStarted,
}

/// A failure as it crosses the wasm boundary: the typed error, and the words
/// the engine would give an agent for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct EngineError {
    /// What went wrong.
    pub error: RunError,
    /// The error in words.
    pub message: String,
}

impl From<RunError> for EngineError {
    fn from(error: RunError) -> Self {
        Self {
            message: error.to_string(),
            error,
        }
    }
}

/// What a request is answered with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type, strum::Display)]
#[serde(rename_all = "camelCase")]
pub enum Answer {
    /// A page of rows, through [`Engine::feed_page`].
    #[strum(serialize = "a page")]
    Page,
    /// The bins of a grouped read, through [`Engine::feed_bins`].
    #[strum(serialize = "bins")]
    Bins,
    /// The results of ops, through [`Engine::feed_ops`].
    #[strum(serialize = "op results")]
    OpResults,
}

/// The op a statement sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type, strum::Display)]
#[serde(rename_all = "camelCase")]
pub enum SentOp {
    /// Rows inserted, updated or deleted.
    #[strum(serialize = "a row write")]
    RowWrite,
    /// A column's type change.
    #[strum(serialize = "a column type change")]
    ColumnTypeChange,
}

/// The kind of an [`OpResult`], with what happened to its resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type, strum::Display)]
#[serde(rename_all = "camelCase")]
pub enum OpResultKind {
    /// [`TableResult::Created`] of an [`OpResult::Table`].
    #[strum(serialize = "a table created")]
    TableCreated,
    /// [`TableResult::Renamed`] of an [`OpResult::Table`].
    #[strum(serialize = "a table renamed")]
    TableRenamed,
    /// [`TableResult::Deleted`] of an [`OpResult::Table`].
    #[strum(serialize = "a table deleted")]
    TableDeleted,
    /// [`TableResult::ColumnsReordered`] of an [`OpResult::Table`].
    #[strum(serialize = "columns reordered")]
    ColumnsReordered,
    /// [`TableResult::ViewsReordered`] of an [`OpResult::Table`].
    #[strum(serialize = "views reordered")]
    ViewsReordered,
    /// [`ColumnResult::Created`] of an [`OpResult::Column`].
    #[strum(serialize = "a column created")]
    ColumnCreated,
    /// [`ColumnResult::Renamed`] of an [`OpResult::Column`].
    #[strum(serialize = "a column renamed")]
    ColumnRenamed,
    /// [`ColumnResult::TypeChanged`] of an [`OpResult::Column`].
    #[strum(serialize = "a column type changed")]
    ColumnTypeChanged,
    /// [`ColumnResult::Deleted`] of an [`OpResult::Column`].
    #[strum(serialize = "a column deleted")]
    ColumnDeleted,
    /// [`ColumnResult::OptionsAdded`] of an [`OpResult::Column`].
    #[strum(serialize = "options added")]
    OptionsAdded,
    /// [`ColumnResult::OptionUpdated`] of an [`OpResult::Column`].
    #[strum(serialize = "an option updated")]
    OptionUpdated,
    /// [`ColumnResult::OptionDeleted`] of an [`OpResult::Column`].
    #[strum(serialize = "an option deleted")]
    OptionDeleted,
    /// [`RowsResult::Inserted`] of an [`OpResult::Rows`].
    #[strum(serialize = "rows inserted")]
    RowsInserted,
    /// [`RowsResult::Updated`] of an [`OpResult::Rows`].
    #[strum(serialize = "rows updated")]
    RowsUpdated,
    /// [`RowsResult::Deleted`] of an [`OpResult::Rows`].
    #[strum(serialize = "rows deleted")]
    RowsDeleted,
    /// [`ViewResult::Created`] of an [`OpResult::View`].
    #[strum(serialize = "a view created")]
    ViewCreated,
    /// [`ViewResult::Updated`] of an [`OpResult::View`].
    #[strum(serialize = "a view updated")]
    ViewUpdated,
    /// [`ViewResult::Deleted`] of an [`OpResult::View`].
    #[strum(serialize = "a view deleted")]
    ViewDeleted,
    /// [`ViewResult::CardMoved`] of an [`OpResult::View`].
    #[strum(serialize = "a card moved")]
    CardMoved,
    /// [`OpResult::ReorderTables`].
    #[strum(serialize = "tables reordered")]
    TablesReordered,
}

impl From<&OpResult> for OpResultKind {
    fn from(result: &OpResult) -> Self {
        match result {
            OpResult::Table {
                change: TableResult::Created,
                ..
            } => OpResultKind::TableCreated,
            OpResult::Table {
                change: TableResult::Renamed,
                ..
            } => OpResultKind::TableRenamed,
            OpResult::Table {
                change: TableResult::Deleted,
                ..
            } => OpResultKind::TableDeleted,
            OpResult::Table {
                change: TableResult::ColumnsReordered,
                ..
            } => OpResultKind::ColumnsReordered,
            OpResult::Table {
                change: TableResult::ViewsReordered { .. },
                ..
            } => OpResultKind::ViewsReordered,
            OpResult::Column {
                change: ColumnResult::Created,
                ..
            } => OpResultKind::ColumnCreated,
            OpResult::Column {
                change: ColumnResult::Renamed,
                ..
            } => OpResultKind::ColumnRenamed,
            OpResult::Column {
                change: ColumnResult::TypeChanged,
                ..
            } => OpResultKind::ColumnTypeChanged,
            OpResult::Column {
                change: ColumnResult::Deleted,
                ..
            } => OpResultKind::ColumnDeleted,
            OpResult::Column {
                change: ColumnResult::OptionsAdded { .. },
                ..
            } => OpResultKind::OptionsAdded,
            OpResult::Column {
                change: ColumnResult::OptionUpdated,
                ..
            } => OpResultKind::OptionUpdated,
            OpResult::Column {
                change: ColumnResult::OptionDeleted,
                ..
            } => OpResultKind::OptionDeleted,
            OpResult::Rows {
                change: RowsResult::Inserted { .. },
                ..
            } => OpResultKind::RowsInserted,
            OpResult::Rows {
                change: RowsResult::Updated { .. },
                ..
            } => OpResultKind::RowsUpdated,
            OpResult::Rows {
                change: RowsResult::Deleted { .. },
                ..
            } => OpResultKind::RowsDeleted,
            OpResult::View {
                change: ViewResult::Created { .. },
                ..
            } => OpResultKind::ViewCreated,
            OpResult::View {
                change: ViewResult::Updated { .. },
                ..
            } => OpResultKind::ViewUpdated,
            OpResult::View {
                change: ViewResult::Deleted,
                ..
            } => OpResultKind::ViewDeleted,
            OpResult::View {
                change: ViewResult::CardMoved { .. },
                ..
            } => OpResultKind::CardMoved,
            OpResult::ReorderTables { .. } => OpResultKind::TablesReordered,
        }
    }
}

/// A value a driver hands the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type, strum::Display)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "lowercase")]
pub enum Input {
    /// The catalog a statement compiles against.
    Catalog,
    /// The schema a catalog is built from.
    Schema,
    /// The database a catalog is scoped to.
    Scope,
    /// A page of rows.
    Page,
    /// The bins of a grouped read.
    Bins,
    /// A view.
    View,
    /// What a view's read produced.
    Outcome,
    /// The stored positions of a board's cards.
    Positions,
}

impl From<CompileError> for RunError {
    fn from(error: CompileError) -> Self {
        match error {
            CompileError::Parse(error) => RunError::Parse(error),
            CompileError::Resolve(error) => RunError::Resolve(error),
        }
    }
}

impl From<ViewProblem> for RunError {
    fn from(problem: ViewProblem) -> Self {
        RunError::View(problem)
    }
}

/// What a statement produced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// The result columns, in select-list order; empty for writes.
    pub columns: Vec<OutcomeColumn>,
    /// The result rows.
    pub rows: Table,
    /// For a row-shaped result, the row entity id behind each result row.
    pub row_ids: Vec<RowId>,
    /// The tables read, so a caller can watch them for changes.
    pub read_tables: Vec<TableId>,
    /// Whether the read hit [`ROW_CAP`], making aggregates partial.
    pub truncated: bool,
    /// Rows an `INSERT` created, in statement order for the rows that landed.
    pub inserted_row_ids: Vec<RowId>,
    /// Rows a write changed.
    pub changes_applied: u32,
    /// The column an `ALTER COLUMN` changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub altered_column: Option<AlteredColumn>,
}

/// A column whose type an `ALTER COLUMN` changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AlteredColumn {
    /// The table.
    pub table: TableId,
    /// The column's property definition before the change.
    pub column: Uuid,
    /// The type it became, as SQL spells it.
    pub to: String,
}

/// One result column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeColumn {
    /// The name as the statement would call it: the column's display name,
    /// or `SUM(amount)`.
    pub name: String,
    /// The column behind the values, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<Uuid>,
    /// What the values are.
    pub kind: OutcomeKind,
    /// For `row_id`, the table whose rows its cells are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table: Option<TableId>,
}

/// The value kind of a result column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum OutcomeKind {
    /// Text or link.
    Text,
    /// A number, including every aggregate but `MIN`/`MAX` of dates.
    Number,
    /// A checkbox.
    Boolean,
    /// A date-time.
    Date,
    /// Select option ids; the caller labels them from the catalog.
    Select,
    /// Entity ids; the caller hydrates them.
    Entity,
    /// The `row_id` column: the ids of the table's own rows.
    Row,
}

/// Compile and execute one statement.
pub async fn run<Source: RowSource, Sink: OpsSink>(
    catalog: &Catalog,
    sql: &str,
    source: &Source,
    sink: &Sink,
) -> Result<Outcome, RunFailure<Source::Error, Sink::Error>> {
    let (mut engine, mut step) = Engine::start(catalog, sql)?;
    loop {
        step = match step {
            Step::Done(outcome) => return Ok(outcome),
            Step::Fetch(request) => {
                let page = source
                    .page(
                        &request.query,
                        &request.needs,
                        request.cursor,
                        request.limit,
                    )
                    .await
                    .map_err(RunFailure::Source)?;
                engine.feed_page(request.id, page)?
            }
            Step::Bins(request) => {
                let bins = source
                    .bins(&request.query)
                    .await
                    .map_err(RunFailure::Source)?;
                engine.feed_bins(request.id, bins)?
            }
            Step::Ops { id, database, ops } => {
                let results = sink.apply(database, ops).await.map_err(RunFailure::Write)?;
                engine.feed_ops(id, results)?
            }
        };
    }
}

/// The columns a resolved `SELECT` returns, named and typed as its outcome
/// will be.
pub fn result_columns(catalog: &Catalog, select: &SelectQuery) -> Vec<OutcomeColumn> {
    describe(
        catalog,
        &select.items,
        &select.labels,
        &select.bindings,
        &select.relations,
    )
}

/// Name and type each select item.
pub(crate) fn describe(
    catalog: &Catalog,
    items: &[SelectItem],
    labels: &[(usize, String)],
    bindings: &[Binding],
    relations: &[Relation],
) -> Vec<OutcomeColumn> {
    let column = |key: Uuid| {
        column_of(catalog, bindings, relations, key)
            .cloned()
            .or_else(|| virtual_column_of(bindings, relations, key))
            .expect("select items are bound in the scope")
    };
    let mut columns: Vec<OutcomeColumn> = items
        .iter()
        .map(|item| match item {
            SelectItem::Column(key) => {
                let column = column(*key);
                let bound = binding(bindings, *key);
                let row_table = bound
                    .map(|bound| relations[bound.relation].table)
                    .filter(|table| *key == row_id_key(*table));
                OutcomeColumn {
                    column: bound.and_then(|bound| bound.column),
                    table: row_table,
                    kind: match column.kind {
                        _ if row_table.is_some() => OutcomeKind::Row,
                        ColumnKind::Text | ColumnKind::Link => OutcomeKind::Text,
                        ColumnKind::Number => OutcomeKind::Number,
                        ColumnKind::Boolean => OutcomeKind::Boolean,
                        ColumnKind::Date => OutcomeKind::Date,
                        ColumnKind::Select { .. } => OutcomeKind::Select,
                        ColumnKind::Entity { .. } => OutcomeKind::Entity,
                    },
                    name: column.name,
                }
            }
            SelectItem::Aggregate {
                function,
                column: None,
            } => OutcomeColumn {
                name: format!("{}(*)", function.name()),
                column: None,
                kind: OutcomeKind::Number,
                table: None,
            },
            SelectItem::Aggregate {
                function,
                column: Some(key),
            } => {
                let column = column(*key);
                OutcomeColumn {
                    name: format!("{}({})", function.name(), column.name),
                    column: None,
                    kind: match (function, &column.kind) {
                        (AggregateFunction::Min | AggregateFunction::Max, ColumnKind::Date) => {
                            OutcomeKind::Date
                        }
                        _ => OutcomeKind::Number,
                    },
                    table: None,
                }
            }
        })
        .collect();
    for (index, label) in labels {
        if let Some(column) = columns.get_mut(*index) {
            column.name = label.clone();
        }
    }
    columns
}
