//! The embedded SQLite executor: per-request in-memory databases used for
//! analysis, sandboxed execution with changeset capture, and snapshot
//! serialization. Nothing here persists — Postgres is the source of truth.
//!
//! rusqlite features in play:
//! - `authorizer`: dependency discovery during [`SqlExecutor::analyze`]
//!   (every `Read`/`Insert`/`Update`/`Delete` the planner authorizes is a
//!   dependency) and read-only/DDL enforcement during execution.
//! - `session`: records row-level changes made by the statement into a
//!   changeset, which the domain service translates into typed commands.
//! - `progress_handler`: the wall-clock execution budget.
//! - `serialize`: the takeout snapshot bytes.
//!
//! The schema is compiled with the property model as constraints (`STRICT`
//! typing, `CHECK (col IN (...))` from select options, foreign keys and
//! primary keys), so SQLite itself rejects invalid writes before a changeset
//! ever exists.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fallible_streaming_iterator::FallibleStreamingIterator;
use rusqlite::hooks::{Action, AuthAction, AuthContext, Authorization};
use rusqlite::session::Session;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Batch, Connection, DatabaseName, ErrorCode};

use crate::domain::models::{
    Catalog, ColumnSchema, MaterializedTable, QueryError, QueryResult, RawOp, RawRowChange,
    ReferencedTable, ResultColumn, SqlValue, TableDeps, TableSchema, TableSource,
};
use crate::domain::ports::SqlExecutor;

/// Execution budget knobs.
#[derive(Debug, Clone)]
pub struct ExecutorLimits {
    /// Wall-clock budget per statement batch (analysis and execution each).
    pub timeout: Duration,
    /// Maximum rows one result set may return.
    pub max_result_rows: usize,
    /// Maximum total bytes of text across all result sets.
    pub max_result_bytes: usize,
    /// Maximum row changes one exec may produce.
    pub max_changes: usize,
    /// Maximum statement text length SQLite will accept.
    pub max_sql_bytes: usize,
    /// Maximum length of a single string or blob value.
    pub max_value_bytes: usize,
}

impl Default for ExecutorLimits {
    fn default() -> Self {
        Self {
            timeout: Duration::from_millis(250),
            max_result_rows: 10_000,
            max_result_bytes: 16 * 1024 * 1024,
            max_changes: 10_000,
            max_sql_bytes: 256 * 1024,
            max_value_bytes: 1024 * 1024,
        }
    }
}

/// [`SqlExecutor`] backed by rusqlite in-memory connections.
#[derive(Debug, Clone)]
pub struct RusqliteExecutor {
    limits: ExecutorLimits,
}

/// Number of VM steps between progress-handler (timeout) checks.
const PROGRESS_OPS: i32 = 1_000;

/// The dependency map's mutex was poisoned by a panicking hook.
#[derive(Debug, thiserror::Error)]
#[error("authorizer dependency map poisoned")]
struct PoisonedDeps;

/// What the authorizer decided to refuse, so the SQLITE_AUTH error can carry
/// a human explanation instead of "not authorized".
type Denial = Arc<Mutex<Option<String>>>;

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sql_error(err: rusqlite::Error, denial: &Denial) -> QueryError {
    if let rusqlite::Error::SqliteFailure(failure, _) = &err {
        match failure.code {
            ErrorCode::OperationInterrupted => return QueryError::BudgetExceeded,
            ErrorCode::AuthorizationForStatementDenied => {
                if let Some(reason) = denial.lock().ok().and_then(|d| d.clone()) {
                    return QueryError::ReadOnly(reason);
                }
                return QueryError::ReadOnly("statement not permitted".to_string());
            }
            _ => {}
        }
    }
    QueryError::Sql(err.to_string())
}

fn to_sql_value(value: ValueRef<'_>) -> SqlValue {
    match value {
        ValueRef::Null => SqlValue::Null,
        ValueRef::Integer(i) => SqlValue::Integer(i),
        ValueRef::Real(f) => SqlValue::Real(f),
        ValueRef::Text(t) => SqlValue::Text(String::from_utf8_lossy(t).into_owned()),
        // Blobs cannot come from materialized data; surface them as hex so
        // nothing is silently dropped.
        ValueRef::Blob(b) => SqlValue::Text(b.iter().map(|x| format!("{x:02x}")).collect()),
    }
}

fn to_rusqlite_value(value: &SqlValue) -> Value {
    match value {
        SqlValue::Null => Value::Null,
        SqlValue::Integer(i) => Value::Integer(*i),
        SqlValue::Real(f) => Value::Real(*f),
        SqlValue::Text(t) => Value::Text(t.clone()),
    }
}

/// Table-level facts the execution authorizer needs, precomputed so the
/// `'static` hook closure owns them.
#[derive(Debug, Clone, Default)]
struct WritePolicy {
    /// SQL name → whether any write is allowed.
    table_writable: HashMap<String, bool>,
    /// SQL name → columns that may not be updated (derived/read-only).
    readonly_columns: HashMap<String, HashSet<String>>,
}

impl WritePolicy {
    fn from_catalog(catalog: &Catalog) -> Self {
        let mut policy = Self::default();
        for table in &catalog.tables {
            policy
                .table_writable
                .insert(table.sql_name.clone(), table.writable);
            let readonly: HashSet<String> = table
                .columns
                .iter()
                .filter(|c| !c.writable)
                .map(|c| c.sql_name.clone())
                .collect();
            policy
                .readonly_columns
                .insert(table.sql_name.clone(), readonly);
        }
        policy
    }
}

/// The authorizer decision shared by analysis and execution: dependency
/// collection plus a DDL/pragma/attach blanket ban. `policy` is `None` during
/// analysis (writes are recorded, not judged) and `Some` during execution.
fn authorize(
    ctx: AuthContext<'_>,
    deps: &Mutex<HashMap<String, ReferencedTable>>,
    policy: Option<&WritePolicy>,
    denial: &Denial,
) -> Authorization {
    fn deny(denial: &Denial, reason: String) -> Authorization {
        if let Ok(mut slot) = denial.lock() {
            slot.get_or_insert(reason);
        }
        Authorization::Deny
    }
    fn entry<'a>(
        deps: &'a mut HashMap<String, ReferencedTable>,
        table: &str,
    ) -> &'a mut ReferencedTable {
        deps.entry(table.to_string())
            .or_insert_with(|| ReferencedTable {
                read_columns: Vec::new(),
                written: false,
            })
    }
    fn write_allowed(
        policy: Option<&WritePolicy>,
        table: &str,
        column: Option<&str>,
    ) -> Result<(), String> {
        let Some(policy) = policy else { return Ok(()) };
        match policy.table_writable.get(table) {
            Some(true) => {}
            Some(false) => return Err(format!("table {table} is read-only")),
            None => return Err(format!("unknown table {table}")),
        }
        if let Some(column) = column
            && policy
                .readonly_columns
                .get(table)
                .is_some_and(|cols| cols.contains(column))
        {
            return Err(format!("column {table}.{column} is derived and read-only"));
        }
        Ok(())
    }

    let Ok(mut deps) = deps.lock() else {
        return Authorization::Deny;
    };
    match ctx.action {
        AuthAction::Read {
            table_name,
            column_name,
        } => {
            // Schema introspection (`sqlite_master`) is the viewer's own
            // compiled catalog and stays readable; it is not a data dependency.
            if table_name.starts_with("sqlite_") {
                return Authorization::Allow;
            }
            // `count(*)` and rowid reads arrive with an empty column name; the
            // table is still a dependency.
            let table = entry(&mut deps, table_name);
            if !column_name.is_empty() && !table.read_columns.iter().any(|c| c == column_name) {
                table.read_columns.push(column_name.to_string());
            }
            Authorization::Allow
        }
        AuthAction::Insert { table_name } | AuthAction::Delete { table_name } => {
            if let Err(reason) = write_allowed(policy, table_name, None) {
                return deny(denial, reason);
            }
            entry(&mut deps, table_name).written = true;
            Authorization::Allow
        }
        AuthAction::Update {
            table_name,
            column_name,
        } => {
            if let Err(reason) = write_allowed(policy, table_name, Some(column_name)) {
                return deny(denial, reason);
            }
            entry(&mut deps, table_name).written = true;
            Authorization::Allow
        }
        AuthAction::Select
        | AuthAction::Function { .. }
        | AuthAction::Recursive
        | AuthAction::Transaction { .. }
        | AuthAction::Savepoint { .. } => Authorization::Allow,
        // The session extension introspects tables it records through these
        // read-only pragmas; every other pragma is banned below.
        AuthAction::Pragma {
            pragma_name:
                "table_info" | "table_xinfo" | "index_list" | "index_info" | "index_xinfo"
                | "foreign_key_list",
            ..
        } => Authorization::Allow,
        // Everything structural — DDL, pragmas, attach, vtables — is banned:
        // the scratch schema is compiled from the catalog, never by SQL.
        other => deny(
            denial,
            format!("operation not permitted in a database query: {other:?}"),
        ),
    }
}

impl RusqliteExecutor {
    /// Create an executor with the given limits.
    pub fn new(limits: ExecutorLimits) -> Self {
        Self { limits }
    }

    /// Compile a catalog table's schema to SQLite DDL carrying the validity
    /// model: `STRICT` typing, `CHECK (col IN (…))` from select options,
    /// primary/foreign keys, NOT NULL — plus one read-only view per alias.
    /// User-table primary keys default to a `new:`-prefixed placeholder so
    /// `INSERT` statements need not supply one; the repo mints the real id
    /// when applying the change and translation refuses references to the
    /// placeholder.
    pub fn compile_ddl(schema: &TableSchema) -> Vec<String> {
        let is_user_table = matches!(schema.source, TableSource::UserTable(_));
        let mut parts: Vec<String> = schema
            .columns
            .iter()
            .map(|column| {
                let mut def = format!(
                    "{} {}",
                    quote_ident(&column.sql_name),
                    column.sql_type.ddl_name()
                );
                if column.not_null {
                    def.push_str(" NOT NULL");
                }
                if is_user_table
                    && schema.primary_key.len() == 1
                    && schema.primary_key[0] == column.sql_name
                    && column.sql_type == crate::domain::models::SqlType::Text
                {
                    def.push_str(" DEFAULT ('new:' || lower(hex(randomblob(8))))");
                }
                if let Some(values) = column
                    .allowed_values
                    .as_ref()
                    .filter(|_| !column.is_multi_select)
                {
                    let list = values
                        .iter()
                        .map(|v| quote_literal(v))
                        .collect::<Vec<_>>()
                        .join(", ");
                    def.push_str(&format!(
                        " CHECK ({col} IS NULL OR {col} IN ({list}))",
                        col = quote_ident(&column.sql_name)
                    ));
                }
                def
            })
            .collect();
        if !schema.primary_key.is_empty() {
            parts.push(format!(
                "PRIMARY KEY ({})",
                schema
                    .primary_key
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        for fk in &schema.foreign_keys {
            parts.push(format!(
                "FOREIGN KEY ({}) REFERENCES {}({})",
                quote_ident(&fk.column),
                quote_ident(&fk.references_table),
                quote_ident(&fk.references_column)
            ));
        }
        let mut statements = vec![format!(
            "CREATE TABLE {} (\n  {}\n) STRICT",
            quote_ident(&schema.sql_name),
            parts.join(",\n  ")
        )];
        for alias in &schema.aliases {
            statements.push(format!(
                "CREATE VIEW {} AS SELECT * FROM {}",
                quote_ident(alias),
                quote_ident(&schema.sql_name)
            ));
        }
        statements
    }

    fn open(&self) -> Result<Connection, QueryError> {
        let conn = Connection::open_in_memory().map_err(|e| QueryError::Sql(e.to_string()))?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| QueryError::Sql(e.to_string()))?;
        // Hard caps SQLite enforces itself: statement text, single values,
        // expression nesting, and compound/like complexity.
        conn.set_limit(
            rusqlite::limits::Limit::SQLITE_LIMIT_SQL_LENGTH,
            self.limits.max_sql_bytes as i32,
        );
        conn.set_limit(
            rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,
            self.limits.max_value_bytes as i32,
        );
        conn.set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_EXPR_DEPTH, 200);
        conn.set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_COMPOUND_SELECT, 50);
        conn.set_limit(
            rusqlite::limits::Limit::SQLITE_LIMIT_LIKE_PATTERN_LENGTH,
            1_000,
        );
        Ok(conn)
    }

    fn create_schema<'a>(
        conn: &Connection,
        schemas: impl Iterator<Item = &'a TableSchema>,
    ) -> Result<(), QueryError> {
        for schema in schemas {
            for statement in Self::compile_ddl(schema) {
                conn.execute_batch(&statement).map_err(|e| {
                    QueryError::Infrastructure(rootcause::Report::new(e).into_dynamic())
                })?;
            }
        }
        Ok(())
    }

    fn load(conn: &Connection, tables: &[MaterializedTable]) -> Result<(), QueryError> {
        let infra = |e: rusqlite::Error| {
            QueryError::Infrastructure(rootcause::Report::new(e).into_dynamic())
        };
        // Existing data is loaded as-is: a cell whose select option was
        // deleted materializes as the raw option id, which the CHECK compiled
        // from the current options would reject. Constraints apply to what
        // the statement writes, not to what Postgres already holds.
        conn.execute_batch("PRAGMA ignore_check_constraints = ON; BEGIN")
            .map_err(infra)?;
        for table in tables {
            if table.rows.is_empty() {
                continue;
            }
            let columns = table
                .schema
                .columns
                .iter()
                .map(|c| quote_ident(&c.sql_name))
                .collect::<Vec<_>>()
                .join(", ");
            let placeholders = vec!["?"; table.schema.columns.len()].join(", ");
            let mut stmt = conn
                .prepare(&format!(
                    "INSERT INTO {} ({columns}) VALUES ({placeholders})",
                    quote_ident(&table.schema.sql_name)
                ))
                .map_err(infra)?;
            for row in &table.rows {
                stmt.execute(rusqlite::params_from_iter(
                    row.iter().map(to_rusqlite_value),
                ))
                .map_err(infra)?;
            }
        }
        conn.execute_batch("COMMIT; PRAGMA ignore_check_constraints = OFF")
            .map_err(infra)?;
        Ok(())
    }

    fn install_budget(&self, conn: &Connection) {
        let deadline = Instant::now() + self.limits.timeout;
        conn.progress_handler(PROGRESS_OPS, Some(move || Instant::now() > deadline));
    }

    /// Best-effort result provenance without `column_metadata`: a result
    /// column whose name matches exactly one column among the referenced
    /// tables is attributed to it.
    fn provenance(
        name: &str,
        referenced: &[&TableSchema],
    ) -> (Option<(String, String)>, Option<model_entity::EntityType>) {
        let mut hits = referenced.iter().flat_map(|t| {
            t.columns
                .iter()
                .filter(|c| c.sql_name == name)
                .map(move |c| (t, c))
        });
        match (hits.next(), hits.next()) {
            (Some((table, column)), None) => (
                Some((table.sql_name.clone(), column.sql_name.clone())),
                column.entity_type,
            ),
            _ => (None, None),
        }
    }

    fn collect_changes(
        session: &mut Session<'_>,
        by_name: &HashMap<String, &TableSchema>,
        max_changes: usize,
    ) -> Result<Vec<RawRowChange>, QueryError> {
        let infra = |e: rusqlite::Error| {
            QueryError::Infrastructure(rootcause::Report::new(e).into_dynamic())
        };
        let changeset = session.changeset().map_err(infra)?;
        let mut iter = changeset.iter().map_err(infra)?;
        let mut changes = Vec::new();
        while let Some(item) = FallibleStreamingIterator::next(&mut iter).map_err(infra)? {
            // Checked before the change is decoded, so the cap is exact and no
            // work is done on the change that breaks it.
            if changes.len() >= max_changes {
                return Err(QueryError::BudgetExceeded);
            }
            let op = item.op().map_err(infra)?;
            let table_name = op.table_name().to_string();
            let Some(schema) = by_name.get(table_name.as_str()) else {
                return Err(QueryError::UntranslatableChange(format!(
                    "change on unknown table {table_name}"
                )));
            };
            let pk_flags = item.pk().map_err(infra)?.to_vec();
            let column_name = |i: usize| -> String {
                schema
                    .columns
                    .get(i)
                    .map(|c| c.sql_name.clone())
                    .unwrap_or_else(|| format!("column_{i}"))
            };
            let n = op.number_of_columns().max(0) as usize;
            let mut primary_key = Vec::new();
            let mut new_values = Vec::new();
            let raw_op = match op.code() {
                Action::SQLITE_INSERT => {
                    for i in 0..n {
                        let value = to_sql_value(item.new_value(i).map_err(infra)?);
                        if pk_flags.get(i).copied().unwrap_or(0) != 0 {
                            primary_key.push((column_name(i), value.clone()));
                        }
                        new_values.push((column_name(i), value));
                    }
                    RawOp::Insert
                }
                Action::SQLITE_UPDATE => {
                    for i in 0..n {
                        if pk_flags.get(i).copied().unwrap_or(0) != 0 {
                            primary_key.push((
                                column_name(i),
                                to_sql_value(item.old_value(i).map_err(infra)?),
                            ));
                        }
                        // Unchanged columns are absent from the changeset;
                        // rusqlite reports them as an invalid index.
                        if let Ok(value) = item.new_value(i) {
                            new_values.push((column_name(i), to_sql_value(value)));
                        }
                    }
                    RawOp::Update
                }
                Action::SQLITE_DELETE => {
                    for i in 0..n {
                        if pk_flags.get(i).copied().unwrap_or(0) != 0 {
                            primary_key.push((
                                column_name(i),
                                to_sql_value(item.old_value(i).map_err(infra)?),
                            ));
                        }
                    }
                    RawOp::Delete
                }
                _ => {
                    return Err(QueryError::UntranslatableChange(format!(
                        "unknown change kind on {table_name}"
                    )));
                }
            };
            changes.push(RawRowChange {
                table: table_name,
                op: raw_op,
                primary_key,
                new_values,
            });
        }
        Ok(changes)
    }
}

impl SqlExecutor for RusqliteExecutor {
    #[tracing::instrument(skip(self, catalog, sql), err)]
    fn analyze(&self, catalog: &Catalog, sql: &str) -> Result<TableDeps, QueryError> {
        let conn = self.open()?;
        Self::create_schema(&conn, catalog.tables.iter())?;

        let deps: Arc<Mutex<HashMap<String, ReferencedTable>>> = Arc::default();
        let denial: Denial = Arc::default();
        {
            let deps = deps.clone();
            let denial = denial.clone();
            conn.authorizer(Some(move |ctx: AuthContext<'_>| {
                authorize(ctx, &deps, None, &denial)
            }));
        }

        self.install_budget(&conn);
        // Preparing compiles each statement (running the authorizer) without
        // executing anything.
        let mut batch = Batch::new(&conn, sql);
        loop {
            match batch.next() {
                Ok(Some(_statement)) => {}
                Ok(None) => break,
                Err(err) => return Err(sql_error(err, &denial)),
            }
        }
        conn.authorizer::<fn(AuthContext<'_>) -> Authorization>(None);

        let mut tables = deps
            .lock()
            .map_err(|_| {
                QueryError::Infrastructure(rootcause::Report::new(PoisonedDeps).into_dynamic())
            })?
            .clone();
        // The authorizer also reports reads of table-valued functions
        // (`json_each`, which `HAS` desugars to); only catalog tables are
        // dependencies to materialize. Anything else the statement named
        // would already have failed to prepare.
        let known: HashSet<&str> = catalog.tables.iter().map(|t| t.sql_name.as_str()).collect();
        tables.retain(|name, _| known.contains(name.as_str()));
        Ok(TableDeps { tables })
    }

    #[tracing::instrument(skip(self, catalog, tables, sql), err)]
    fn execute(
        &self,
        catalog: &Catalog,
        tables: Vec<MaterializedTable>,
        sql: &str,
    ) -> Result<(Vec<QueryResult>, Vec<RawRowChange>), QueryError> {
        let conn = self.open()?;
        Self::create_schema(&conn, tables.iter().map(|t| &t.schema))?;
        Self::load(&conn, &tables)?;

        let by_name: HashMap<String, &TableSchema> = tables
            .iter()
            .map(|t| (t.schema.sql_name.clone(), &t.schema))
            .collect();
        let referenced: Vec<&TableSchema> = tables.iter().map(|t| &t.schema).collect();

        let policy = WritePolicy::from_catalog(catalog);
        let deps: Arc<Mutex<HashMap<String, ReferencedTable>>> = Arc::default();
        let denial: Denial = Arc::default();
        {
            let deps = deps.clone();
            let denial = denial.clone();
            conn.authorizer(Some(move |ctx: AuthContext<'_>| {
                authorize(ctx, &deps, Some(&policy), &denial)
            }));
        }
        self.install_budget(&conn);

        let mut session = Session::new(&conn)
            .map_err(|e| QueryError::Infrastructure(rootcause::Report::new(e).into_dynamic()))?;
        session
            .attach(None)
            .map_err(|e| QueryError::Infrastructure(rootcause::Report::new(e).into_dynamic()))?;

        let run = || -> Result<Vec<QueryResult>, QueryError> {
            conn.execute_batch("BEGIN")
                .map_err(|e| sql_error(e, &denial))?;
            let mut results = Vec::new();
            let mut result_bytes = 0usize;
            let mut batch = Batch::new(&conn, sql);
            loop {
                let mut statement = match batch.next() {
                    Ok(Some(statement)) => statement,
                    Ok(None) => break,
                    Err(err) => return Err(sql_error(err, &denial)),
                };
                if statement.column_count() == 0 {
                    statement.raw_execute().map_err(|e| sql_error(e, &denial))?;
                    continue;
                }
                let columns: Vec<ResultColumn> = statement
                    .column_names()
                    .into_iter()
                    .map(|name| {
                        let (origin, entity_type) = Self::provenance(name, &referenced);
                        ResultColumn {
                            name: name.to_string(),
                            entity_type,
                            origin,
                        }
                    })
                    .collect();
                let width = columns.len();
                let mut rows_out = Vec::new();
                let mut rows = statement.raw_query();
                while let Some(row) = rows.next().map_err(|e| sql_error(e, &denial))? {
                    if rows_out.len() >= self.limits.max_result_rows {
                        return Err(QueryError::BudgetExceeded);
                    }
                    let mut values = Vec::with_capacity(width);
                    for i in 0..width {
                        let value =
                            to_sql_value(row.get_ref(i).map_err(|e| sql_error(e, &denial))?);
                        if let SqlValue::Text(text) = &value {
                            result_bytes += text.len();
                            if result_bytes > self.limits.max_result_bytes {
                                return Err(QueryError::BudgetExceeded);
                            }
                        }
                        values.push(value);
                    }
                    rows_out.push(values);
                }
                results.push(QueryResult {
                    columns,
                    rows: rows_out,
                });
            }
            conn.execute_batch("COMMIT")
                .map_err(|e| sql_error(e, &denial))?;
            Ok(results)
        };

        let results = match run() {
            Ok(results) => results,
            Err(err) => {
                // Best effort: the connection is discarded either way.
                let _ = conn.execute_batch("ROLLBACK");
                return Err(err);
            }
        };
        conn.progress_handler::<fn() -> bool>(0, None);
        conn.authorizer::<fn(AuthContext<'_>) -> Authorization>(None);

        let changes = Self::collect_changes(&mut session, &by_name, self.limits.max_changes)?;
        Ok((results, changes))
    }

    #[tracing::instrument(skip(self, tables), err)]
    fn serialize_snapshot(&self, tables: Vec<MaterializedTable>) -> Result<Vec<u8>, QueryError> {
        let conn = self.open()?;
        Self::create_schema(&conn, tables.iter().map(|t| &t.schema))?;
        Self::load(&conn, &tables)?;
        let data = conn
            .serialize(DatabaseName::Main)
            .map_err(|e| QueryError::Infrastructure(rootcause::Report::new(e).into_dynamic()))?;
        Ok(data.to_vec())
    }
}

/// Convenience for tests and the domain service: a plain, writable
/// user-table column of the given storage class.
pub fn column(name: &str, sql_type: crate::domain::models::SqlType) -> ColumnSchema {
    ColumnSchema {
        sql_name: name.to_string(),
        sql_type,
        data_type: None,
        is_multi_select: false,
        definition_id: None,
        entity_type: None,
        writable: true,
        allowed_values: None,
        not_null: false,
    }
}
