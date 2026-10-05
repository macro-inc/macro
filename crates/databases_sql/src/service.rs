//! Running a statement as a viewer: build their catalog, compile against it,
//! refuse what they may not write, and drive the engine.

mod schema;
#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use contacts::domain::ports::ContactsService;
use database_sql::resolve::{CompileError, Query};
use database_sql::run::{OutcomeKind, RunError, RunFailure};
use databases::domain::models::{
    DatabaseError, DatabaseId, QueryDefinition, SavedQuery, SavedQueryError, TableId, TableVersion,
    Viewer,
};
use databases::domain::ports::DatabasesService;
use databases::domain::receipt::database_receipt;
use entity_access::domain::models::{AccessError, EditAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use models_databases::MAX_STATEMENT_LENGTH;
use soup::domain::ports::SoupService;

use crate::catalog::ViewerCatalog;
use crate::ops_sink::{ReceiptOpsSink, ReceiptWriteError};
use crate::outcome::{SqlOutcome, shape};
use crate::row_source::{SoupRowSource, SoupSourceError};
use crate::view_only::ViewOnlyAccess;

/// SQL over the databases a viewer can reach. Reads go through Soup and the
/// viewer's contacts; writes go through the databases service's ops.
pub struct DatabasesSql<Databases, Access, Soup, Contacts> {
    databases: Arc<Databases>,
    entity_access: Arc<Access>,
    soup: Arc<Soup>,
    contacts: Arc<Contacts>,
    read_only: bool,
}

impl<Databases, Access, Soup, Contacts> Clone for DatabasesSql<Databases, Access, Soup, Contacts> {
    fn clone(&self) -> Self {
        Self {
            databases: self.databases.clone(),
            entity_access: self.entity_access.clone(),
            soup: self.soup.clone(),
            contacts: self.contacts.clone(),
            read_only: self.read_only,
        }
    }
}

/// One statement to run.
#[derive(Debug, Clone)]
pub struct SqlRequest {
    /// The statement.
    pub sql: String,
    /// The database the statement is written from. Its tables win over
    /// same-named tables of other databases.
    pub scope: Option<DatabaseId>,
    /// Compare-and-set per written table: a written table listed here must
    /// still be at this version. A written table not listed is written
    /// blind, cell by cell, last write wins.
    pub base_versions: HashMap<TableId, TableVersion>,
}

/// The result columns a saved question's chart plots, which its `SELECT`
/// must return.
#[derive(Debug, Clone, Copy)]
pub struct ChartColumns<'chart> {
    /// The label column.
    pub x: &'chart str,
    /// The value columns, each a number.
    pub y: &'chart [String],
    /// The column whose values split the series.
    pub color: Option<&'chart str>,
}

/// Why a statement did not run.
#[derive(Debug, thiserror::Error)]
pub enum SqlError {
    /// The statement did not compile.
    #[error(transparent)]
    Compile(#[from] CompileError),
    /// The engine refused the statement.
    #[error(transparent)]
    Run(#[from] RunError),
    /// The databases service refused the statement's write.
    #[error("{}", refusal(.row, .reason))]
    WriteRefused {
        /// The refused row's place in the statement, from 1, when one row
        /// is at fault.
        row: Option<usize>,
        /// Why, in the service's words.
        reason: String,
    },
    /// A saved query must be a read.
    #[error("a saved query must be a SELECT; it cannot change data")]
    SavedQueryNotSelect,
    /// A chart names a column the saved `SELECT` does not return.
    #[error("the chart names \"{name}\", but the query returns {}", quoted(.returned))]
    ChartColumnNotReturned {
        /// The column named.
        name: String,
        /// The columns the query returns.
        returned: Vec<String>,
    },
    /// A chart plots a column that does not hold numbers.
    #[error("the chart plots \"{name}\", which is not a number")]
    ChartValueNotNumeric {
        /// The column.
        name: String,
    },
    /// The viewer may read the table but not write it.
    #[error("table {table} is read-only")]
    TableReadOnly {
        /// The table's name.
        table: String,
    },
    /// A written table moved past the version the caller read.
    #[error("table {table_id} changed since it was read")]
    VersionConflict {
        /// The table.
        table_id: TableId,
    },
    /// One of the tables in a schema batch moved past the caller's version.
    #[error("database {database_id} changed since its schema was read")]
    SchemaVersionConflict {
        /// The database whose schema should be refreshed.
        database_id: DatabaseId,
    },
    /// The statement is longer than any statement is allowed to be.
    #[error("the statement is too long")]
    TooLong,
    /// The database or saved query does not exist, or the viewer cannot see
    /// it.
    #[error("not found")]
    NotFound,
    /// The table a compiled write names is missing from the catalog it was
    /// compiled against: the engine broke its own invariant.
    #[error("table {table_id} is not in the catalog the statement compiled against")]
    WrittenTableNotInCatalog {
        /// The table.
        table_id: TableId,
    },
    /// The column an `ALTER COLUMN` changed is missing from the catalog it
    /// was compiled against.
    #[error(
        "column {definition} of table {table_id} is not in the catalog the statement compiled against"
    )]
    AlteredColumnNotInCatalog {
        /// The table.
        table_id: TableId,
        /// The column's property definition.
        definition: uuid::Uuid,
    },
    /// The engine answered an `ALTER COLUMN` without the column it changed.
    #[error("the type change answered without the column it changed")]
    AlterWithoutAlteredColumn,
    /// A service the statement needed failed.
    #[error("the databases service failed")]
    Infrastructure(rootcause::Report),
}

fn quoted(names: &[String]) -> String {
    names
        .iter()
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

fn refusal(row: &Option<usize>, reason: &str) -> String {
    match row {
        Some(row) => format!("row {row}: {reason}"),
        None => reason.to_owned(),
    }
}

impl<Databases, Access, Soup, Contacts> DatabasesSql<Databases, Access, Soup, Contacts>
where
    Databases: DatabasesService,
    Access: EntityAccessService,
    Soup: SoupService,
    Contacts: ContactsService,
{
    /// SQL over these services.
    pub fn new(
        databases: Arc<Databases>,
        entity_access: Arc<Access>,
        soup: Arc<Soup>,
        contacts: Arc<Contacts>,
    ) -> Self {
        Self {
            databases,
            entity_access,
            soup,
            contacts,
            read_only: false,
        }
    }

    /// The same SQL over access capped at view: it reads what the viewer can
    /// see, and every write is refused as the access check refuses a viewer.
    pub fn view_only(&self) -> DatabasesSql<Databases, ViewOnlyAccess<Access>, Soup, Contacts> {
        DatabasesSql {
            databases: self.databases.clone(),
            entity_access: Arc::new(ViewOnlyAccess((*self.entity_access).clone())),
            read_only: true,
            soup: self.soup.clone(),
            contacts: self.contacts.clone(),
        }
    }

    /// Save a read as a question, scoped to `database_id`, once it compiles
    /// as a `SELECT` against the viewer's catalog that returns every column
    /// `chart` plots.
    #[tracing::instrument(skip_all, err)]
    pub async fn save_query(
        &self,
        viewer: Viewer,
        database_id: Option<DatabaseId>,
        definition: QueryDefinition,
        chart: Option<ChartColumns<'_>>,
    ) -> Result<SavedQuery, SqlError> {
        let sql = definition.sql();
        let catalog = self.catalog(&viewer, database_id).await?;
        if let Some(database_id) = database_id
            && !catalog.has_database(database_id)
        {
            return Err(SqlError::NotFound);
        }
        let Query::Select(select) = database_sql::compile(catalog.catalog(), sql)? else {
            return Err(SqlError::SavedQueryNotSelect);
        };
        if let Some(chart) = chart {
            check_chart(
                &database_sql::result_columns(catalog.catalog(), &select),
                chart,
            )?;
        }
        self.databases
            .save_query(viewer, database_id, definition)
            .await
            .map_err(|error| match error {
                SavedQueryError::NotFound => SqlError::NotFound,
                SavedQueryError::TooLong => SqlError::TooLong,
                SavedQueryError::Repo(report) => SqlError::Infrastructure(report),
            })
    }

    /// Run one statement, a read or a write.
    #[tracing::instrument(skip_all, err)]
    pub async fn execute(
        &self,
        viewer: Viewer,
        request: SqlRequest,
    ) -> Result<SqlOutcome, SqlError> {
        if request.sql.len() > MAX_STATEMENT_LENGTH {
            return Err(SqlError::TooLong);
        }
        if let Some(command) =
            database_sql::parse::parse_schema(&request.sql).map_err(CompileError::Parse)?
        {
            return self.execute_schema(viewer, request, command).await;
        }
        let catalog = self.catalog(&viewer, request.scope).await?;
        let query = database_sql::compile(catalog.catalog(), &request.sql)?;
        let mut write_receipt = None;
        let mut written = None;
        if let Some(table) = written_table(&query) {
            let (database, detail) = catalog
                .table(table)
                .ok_or(SqlError::WrittenTableNotInCatalog { table_id: table })?;
            let receipt = database_receipt::<EditAccessLevel, _>(
                self.entity_access.as_ref(),
                &viewer,
                database.database.id,
            )
            .await
            .map_err(|error| match error {
                AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                    SqlError::TableReadOnly {
                        table: detail.table.name.clone(),
                    }
                }
                AccessError::NotFound(_) => SqlError::NotFound,
                other => SqlError::Infrastructure(rootcause::Report::new(other).into_dynamic()),
            })?;
            write_receipt = Some((database.database.id, receipt));
            written = Some((table, detail.table.name.clone()));
            if request
                .base_versions
                .get(&table)
                .is_some_and(|expected| *expected != detail.table.version)
            {
                return Err(SqlError::VersionConflict { table_id: table });
            }
        }

        let source = SoupRowSource {
            soup: self.soup.as_ref(),
            contacts: self.contacts.as_ref(),
            viewer: &viewer.user_id,
            catalog: catalog.catalog(),
        };
        let sink = ReceiptOpsSink {
            databases: self.databases.as_ref(),
            receipt: write_receipt,
            viewer: &viewer,
            versions: Mutex::new(HashMap::new()),
        };
        let outcome = database_sql::run(catalog.catalog(), &request.sql, &source, &sink)
            .await
            .map_err(|failure| run_failure(failure, written))?;
        // The lock only guards single inserts, so a poisoned map is still whole.
        let new_versions = sink
            .versions
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner);
        shape(&catalog, &query, &outcome, new_versions)
    }

    async fn catalog(
        &self,
        viewer: &Viewer,
        scope: Option<DatabaseId>,
    ) -> Result<ViewerCatalog, SqlError> {
        let databases = self
            .databases
            .database_details(viewer.clone())
            .await
            .map_err(|error| match error {
                DatabaseError::Repo(report) => SqlError::Infrastructure(report),
                DatabaseError::NotFound | DatabaseError::Unauthorized => SqlError::NotFound,
                // Refusals of a write: a listing returning one is a broken service.
                other @ (DatabaseError::InvalidSchemaOperation(_)
                | DatabaseError::InvalidSharing(_)
                | DatabaseError::VersionConflict
                | DatabaseError::RowInUse
                | DatabaseError::OptionInUse
                | DatabaseError::InvalidOp(_)) => {
                    SqlError::Infrastructure(rootcause::Report::new(other).into_dynamic())
                }
            })?;
        Ok(ViewerCatalog::new(databases, scope))
    }
}

/// Every column `chart` names is one the query returns, and every value
/// column holds numbers.
fn check_chart(
    returned: &[database_sql::OutcomeColumn],
    chart: ChartColumns<'_>,
) -> Result<(), SqlError> {
    let named = std::iter::once(chart.x)
        .chain(chart.y.iter().map(String::as_str))
        .chain(chart.color);
    for name in named {
        if !returned.iter().any(|column| column.name == name) {
            return Err(SqlError::ChartColumnNotReturned {
                name: name.to_owned(),
                returned: returned.iter().map(|column| column.name.clone()).collect(),
            });
        }
    }
    for name in chart.y {
        if returned
            .iter()
            .any(|column| column.name == *name && column.kind != OutcomeKind::Number)
        {
            return Err(SqlError::ChartValueNotNumeric { name: name.clone() });
        }
    }
    Ok(())
}

/// A failed run in the viewer's terms; `written` is the table the statement
/// writes, with its name.
fn run_failure(
    failure: RunFailure<SoupSourceError, ReceiptWriteError>,
    written: Option<(TableId, String)>,
) -> SqlError {
    match failure {
        RunFailure::Engine(error) => SqlError::Run(error),
        RunFailure::Source(error) => SqlError::Infrastructure(error.into_report()),
        RunFailure::Write(ReceiptWriteError::Database(error)) => match (error, written) {
            (DatabaseError::InvalidOp(refusal), _) => SqlError::WriteRefused {
                row: refusal.row.map(|row| row + 1),
                reason: refusal.reason,
            },
            (DatabaseError::VersionConflict, Some((table_id, _))) => {
                SqlError::VersionConflict { table_id }
            }
            (DatabaseError::Unauthorized, Some((_, table))) => SqlError::TableReadOnly { table },
            (DatabaseError::NotFound, _) => SqlError::NotFound,
            (DatabaseError::Repo(report), _) => SqlError::Infrastructure(report),
            (other, _) => SqlError::Infrastructure(rootcause::Report::new(other).into_dynamic()),
        },
        RunFailure::Write(error @ ReceiptWriteError::UnauthorizedDatabase { .. }) => {
            tracing::error!(error = %error, "a statement wrote a database it was not authorized for");
            SqlError::Infrastructure(rootcause::Report::new(error).into_dynamic())
        }
    }
}

fn written_table(query: &Query) -> Option<TableId> {
    match query {
        Query::Select(_) => None,
        Query::Insert(insert) => Some(insert.table),
        Query::Update(update) => Some(update.table),
        Query::Delete(delete) => Some(delete.table),
        Query::AlterColumnType(alter) => Some(alter.table),
    }
}
