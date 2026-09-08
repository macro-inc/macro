//! The embedded SQLite executor: per-request in-memory databases used for
//! analysis, sandboxed execution with changeset capture, and snapshot
//! serialization. Nothing here persists — Postgres is the source of truth.
//!
//! rusqlite features in play:
//! - `set_authorizer`: dependency discovery during [`SqlExecutor::analyze`]
//!   and read-only/table-allowlist enforcement during execution.
//! - `session`: records row-level changes made by the statement into a
//!   changeset, which the domain service translates into typed commands.
//! - `column_metadata`: origin table/column per result column (provenance for
//!   chip hydration and write-through).
//! - `limits` + `progress_handler`/`interrupt`: the execution budget.
//! - `serialize`: the takeout snapshot bytes.

use crate::domain::models::{
    Catalog, MaterializedTable, QueryError, QueryResult, RowChange, TableDeps,
};
use crate::domain::ports::SqlExecutor;

/// Execution budget knobs.
#[derive(Debug, Clone)]
pub struct ExecutorLimits {
    /// Wall-clock budget per statement batch.
    pub timeout_ms: u64,
    /// Maximum rows a result set may return.
    pub max_result_rows: usize,
    /// Maximum row changes one exec may produce.
    pub max_changes: usize,
}

impl Default for ExecutorLimits {
    fn default() -> Self {
        Self {
            timeout_ms: 250,
            max_result_rows: 10_000,
            max_changes: 10_000,
        }
    }
}

/// [`SqlExecutor`] backed by rusqlite in-memory connections.
#[derive(Debug, Clone)]
pub struct RusqliteExecutor {
    limits: ExecutorLimits,
}

impl RusqliteExecutor {
    /// Create an executor with the given limits.
    pub fn new(limits: ExecutorLimits) -> Self {
        Self { limits }
    }

    /// Compile a catalog table's schema to SQLite DDL carrying the validity
    /// model: `STRICT` typing, `CHECK (col IN (…))` from select options,
    /// FOREIGN KEYs for junction tables, PRIMARY KEY on `row_id`.
    #[allow(dead_code)]
    fn compile_ddl(_schema: &crate::domain::models::TableSchema) -> String {
        todo!("generate CREATE TABLE … STRICT with compiled constraints")
    }
}

impl SqlExecutor for RusqliteExecutor {
    fn analyze(&self, _catalog: &Catalog, _sql: &str) -> Result<TableDeps, QueryError> {
        let _ = &self.limits;
        todo!(
            "open :memory:, create schema-only catalog via compile_ddl, set_authorizer \
             collecting (table, column, write?) tuples, prepare each statement, map \
             rusqlite errors to QueryError::Sql verbatim"
        )
    }

    fn execute(
        &self,
        _catalog: &Catalog,
        _tables: Vec<MaterializedTable>,
        _sql: &str,
    ) -> Result<(Vec<QueryResult>, Vec<RowChange>), QueryError> {
        todo!(
            "open :memory:, compile_ddl + bulk-insert materialized rows in one tx, \
             attach a Session, set_authorizer denying writes to read-only tables, \
             progress_handler enforcing timeout_ms, run statements collecting SELECT \
             results with column_metadata provenance, extract the changeset, map it \
             to RowChange (rowid → row_id via the materialized first column)"
        )
    }

    fn serialize_snapshot(&self, _tables: Vec<MaterializedTable>) -> Result<Vec<u8>, QueryError> {
        todo!("build the database as in execute (no session), then Connection::serialize")
    }
}

// The dependency is wired even while the implementation is a stub so the
// bundled build is validated by CI from day one.
#[allow(unused_imports)]
use rusqlite as _;
