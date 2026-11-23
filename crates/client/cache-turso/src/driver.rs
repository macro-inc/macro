use crate::{PhysicalResetReason, TursoStorageError};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use turso_core::{Connection, LimboError, Row, Statement, StepResult, Value};

pub(crate) type Values = Vec<Value>;
pub(crate) type Rows = Vec<Values>;

/// Distinct statement texts kept prepared per connection. Turso parses and
/// compiles on every `Connection::prepare`; most of the storage's statements
/// are a fixed set of about fifty run many times per hydrate and read. A kept
/// statement holds tens of KB, and browser memory never shrinks, so the bound
/// stays near that working set.
const CACHED_STATEMENT_TEXTS: usize = 96;
/// Texts remembered as run once. A text is kept only from its second use, so
/// texts built per call (IN-lists sized to their keys) and one-off schema
/// reads never take a slot.
const REMEMBERED_TEXTS: usize = 4096;
/// Prepared copies kept per text, for a text that runs nested within itself.
const CACHED_COPIES_PER_TEXT: usize = 2;

/// A connection and the statements prepared on it.
///
/// Clones share one statement cache. Cached statements hold their connection,
/// so the owner calls [`Db::release_statements`] before closing it.
#[derive(Clone)]
pub(crate) struct Db {
    connection: Arc<Connection>,
    statements: Option<Arc<Mutex<StatementCache>>>,
}

impl Db {
    /// A connection whose prepared statements are kept for reuse.
    pub(crate) fn cached(connection: Arc<Connection>) -> Self {
        Self {
            connection,
            statements: Some(Arc::new(Mutex::new(StatementCache::default()))),
        }
    }

    /// A connection that prepares every statement afresh, for short-lived uses
    /// such as opening checks that run before storage owns the connection.
    pub(crate) fn uncached(connection: Arc<Connection>) -> Self {
        Self {
            connection,
            statements: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn cached_copies(&self, sql: &str) -> usize {
        self.statements
            .as_ref()
            .map_or(0, |statements| statements.lock().unwrap().copies(sql))
    }

    #[cfg(test)]
    pub(crate) fn cached_texts(&self) -> usize {
        self.statements
            .as_ref()
            .map_or(0, |statements| statements.lock().unwrap().texts.len())
    }

    /// Drops every cached statement, and with it their connection references.
    pub(crate) fn release_statements(&self) {
        if let Some(statements) = &self.statements {
            match statements.lock() {
                Ok(mut cache) => cache.clear(),
                Err(poisoned) => poisoned.into_inner().clear(),
            }
        }
    }
}

impl std::ops::Deref for Db {
    type Target = Arc<Connection>;

    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}

#[derive(Default)]
struct StatementCache {
    texts: HashMap<String, CachedText>,
    /// Hashes of texts run once and not kept.
    seen_once: HashSet<u64>,
    clock: u64,
}

struct CachedText {
    statements: Vec<Statement>,
    last_used: u64,
}

impl StatementCache {
    fn take(&mut self, sql: &str) -> Option<Statement> {
        self.clock += 1;
        let text = self.texts.get_mut(sql)?;
        text.last_used = self.clock;
        text.statements.pop()
    }

    fn put(&mut self, sql: String, statement: Statement) {
        self.clock += 1;
        let known = self.texts.contains_key(&sql);
        if !known && !self.seen_before(&sql) {
            return;
        }
        if !known && self.texts.len() >= CACHED_STATEMENT_TEXTS {
            let oldest = self
                .texts
                .iter()
                .min_by_key(|(_, text)| text.last_used)
                .map(|(sql, _)| sql.clone());
            if let Some(oldest) = oldest {
                self.texts.remove(&oldest);
            }
        }
        let clock = self.clock;
        let text = self.texts.entry(sql).or_insert_with(|| CachedText {
            statements: Vec::new(),
            last_used: clock,
        });
        text.last_used = clock;
        if text.statements.len() < CACHED_COPIES_PER_TEXT {
            text.statements.push(statement);
        }
    }

    /// Whether `sql` ran once before; remembers it otherwise.
    fn seen_before(&mut self, sql: &str) -> bool {
        let mut hasher = DefaultHasher::new();
        sql.hash(&mut hasher);
        let hash = hasher.finish();
        if self.seen_once.remove(&hash) {
            return true;
        }
        if self.seen_once.len() >= REMEMBERED_TEXTS {
            self.seen_once.clear();
        }
        self.seen_once.insert(hash);
        false
    }

    fn clear(&mut self) {
        self.texts.clear();
        self.seen_once.clear();
    }

    #[cfg(test)]
    fn copies(&self, sql: &str) -> usize {
        self.texts.get(sql).map_or(0, |text| text.statements.len())
    }
}

/// A prepared statement that returns to its connection's cache when dropped,
/// unless a run or reset of it failed.
pub(crate) struct Prepared {
    statement: Option<Statement>,
    sql: String,
    cache: Option<Arc<Mutex<StatementCache>>>,
}

impl Prepared {
    /// Placeholders in the statement text.
    pub(crate) fn parameters_count(&self) -> usize {
        self.statement
            .as_ref()
            .map_or(0, Statement::parameters_count)
    }

    fn statement(&mut self) -> Result<&mut Statement, TursoStorageError> {
        self.statement.as_mut().ok_or(TursoStorageError::Database)
    }

    /// Keeps this statement out of the cache: its last run or reset failed.
    fn discard(&mut self) {
        self.cache = None;
    }
}

#[cfg(test)]
impl std::ops::Deref for Prepared {
    type Target = Statement;

    fn deref(&self) -> &Statement {
        self.statement
            .as_ref()
            .expect("a prepared statement holds its statement until dropped")
    }
}

impl Drop for Prepared {
    fn drop(&mut self) {
        let (Some(cache), Some(mut statement)) = (self.cache.take(), self.statement.take()) else {
            return;
        };
        if statement.reset().is_err() {
            return;
        }
        statement.clear_bindings();
        statement.reset_metrics();
        if let Ok(mut cache) = cache.lock() {
            cache.put(std::mem::take(&mut self.sql), statement);
        }
    }
}

struct RunFailure {
    error: TursoStorageError,
    execution_completed: bool,
    cleanup_failed: bool,
}

impl RunFailure {
    fn execution(error: TursoStorageError) -> Self {
        Self {
            error,
            execution_completed: false,
            cleanup_failed: false,
        }
    }

    fn cleanup(execution_completed: bool) -> Self {
        Self {
            error: TursoStorageError::reset(PhysicalResetReason::TransactionOutcomeUncertain),
            execution_completed,
            cleanup_failed: true,
        }
    }
}

pub(crate) fn prepare(connection: &Db, sql: &str) -> Result<Prepared, TursoStorageError> {
    prepare_turso(connection, sql).map_err(TursoStorageError::turso)
}

/// Prepares generated SQL that has another plan to fall back on, returning
/// `None` when Turso's parser refuses it. Turso bounds expression depth by its
/// parser's recursion and the expression tree's height, so only the parser can
/// say whether a deep expression fits.
pub(crate) fn prepare_unless_refused(
    connection: &Db,
    sql: &str,
) -> Result<Option<Prepared>, TursoStorageError> {
    match prepare_turso(connection, sql) {
        Ok(prepared) => Ok(Some(prepared)),
        Err(LimboError::LexerError(_)) => Ok(None),
        Err(error) => Err(TursoStorageError::turso(error)),
    }
}

fn prepare_turso(connection: &Db, sql: &str) -> Result<Prepared, LimboError> {
    let cached = connection
        .statements
        .as_ref()
        .and_then(|statements| statements.lock().ok()?.take(sql));
    let statement = match cached {
        Some(statement) => statement,
        None => connection.prepare(sql)?,
    };
    Ok(Prepared {
        statement: Some(statement),
        sql: sql.to_owned(),
        cache: connection.statements.clone(),
    })
}

pub(crate) fn validate(connection: &Db, sql: &str) -> Result<(), TursoStorageError> {
    let mut prepared = prepare(connection, sql)?;
    let statement = prepared.statement()?;
    let reset = checked_reset(statement);
    statement.clear_bindings();
    if reset.is_err() {
        prepared.discard();
    }
    reset
}

pub(crate) fn execute(
    connection: &Db,
    sql: &str,
    values: Values,
) -> Result<i64, TursoStorageError> {
    let mut statement = prepare(connection, sql)?;
    execute_prepared(&mut statement, values)
}

pub(crate) fn query(connection: &Db, sql: &str, values: Values) -> Result<Rows, TursoStorageError> {
    let mut statement = prepare(connection, sql)?;
    query_prepared(&mut statement, values)
}

/// Visits each row before stepping again, retaining no result collection.
/// Uses the same checked statement cleanup and telemetry as collected queries.
pub(crate) fn query_each(
    connection: &Db,
    sql: &str,
    values: Values,
    visit: impl FnMut(&Row) -> Result<(), TursoStorageError>,
) -> Result<(), TursoStorageError> {
    let mut statement = prepare(connection, sql)?;
    query_each_prepared(&mut statement, values, visit)
}

pub(crate) fn query_each_prepared(
    statement: &mut Prepared,
    values: Values,
    visit: impl FnMut(&Row) -> Result<(), TursoStorageError>,
) -> Result<(), TursoStorageError> {
    let mut visit = visit;
    visit_prepared(statement, values, |row| visit(row).map(|()| true))
        .map(|_| ())
        .map_err(|failure| failure.error)
}

/// Stops a read when the visitor proves later ordered rows cannot improve its
/// bounded result. The same checked reset runs on both early stop and exhaustion.
pub(crate) fn query_until(
    connection: &Db,
    sql: &str,
    values: Values,
    visit: impl FnMut(&Row) -> Result<bool, TursoStorageError>,
) -> Result<(), TursoStorageError> {
    let mut statement = prepare(connection, sql)?;
    visit_prepared(&mut statement, values, visit)
        .map(|_| ())
        .map_err(|failure| failure.error)
}

pub(crate) fn execute_prepared(
    statement: &mut Prepared,
    values: Values,
) -> Result<i64, TursoStorageError> {
    execute_prepared_detailed(statement, values).map_err(|failure| failure.error)
}

fn execute_prepared_detailed(statement: &mut Prepared, values: Values) -> Result<i64, RunFailure> {
    let (rows, changed) = run_prepared(statement, values)?;
    if rows.is_empty() {
        Ok(changed)
    } else {
        Err(RunFailure::execution(TursoStorageError::Database))
    }
}

pub(crate) fn query_prepared(
    statement: &mut Prepared,
    values: Values,
) -> Result<Rows, TursoStorageError> {
    run_prepared(statement, values)
        .map(|(rows, _)| rows)
        .map_err(|failure| failure.error)
}

fn run_prepared(statement: &mut Prepared, values: Values) -> Result<(Rows, i64), RunFailure> {
    let mut rows = Vec::new();
    let changed = visit_prepared(statement, values, |row| {
        rows.push(row.get_values().cloned().collect());
        Ok(true)
    })?;
    Ok((rows, changed))
}

fn visit_prepared(
    prepared: &mut Prepared,
    values: Values,
    visit: impl FnMut(&Row) -> Result<bool, TursoStorageError>,
) -> Result<i64, RunFailure> {
    let result = match prepared.statement() {
        Ok(statement) => visit_statement(statement, values, visit),
        Err(error) => Err(RunFailure::execution(error)),
    };
    if result.is_err() {
        prepared.discard();
    }
    result
}

fn visit_statement(
    statement: &mut Statement,
    values: Values,
    mut visit: impl FnMut(&Row) -> Result<bool, TursoStorageError>,
) -> Result<i64, RunFailure> {
    // Time binding, stepping/I/O, row processing, and cleanup, not worker queue
    // wait or statement preparation. Reused statements are timed per execution.
    let timer = crate::query_telemetry::QueryTimer::start();
    let execution = (|| {
        if statement.parameters_count() != values.len() {
            return Err(TursoStorageError::Database);
        }
        for (offset, value) in values.into_iter().enumerate() {
            let index = NonZeroUsize::new(offset + 1).ok_or(TursoStorageError::Database)?;
            statement
                .bind_at(index, value)
                .map_err(TursoStorageError::turso)?;
        }

        loop {
            // The pinned Turso revision completes this rollback without
            // producing rollback-owned File work. Native fault tests use this
            // private scheduler hook to exercise a failure from the rollback's
            // StepResult::IO/IO::step polling boundary without manufacturing a
            // completion or describing a post-success error as completion-delivered.
            #[cfg(all(test, not(target_arch = "wasm32")))]
            let forced_control_io = take_forced_control_io();
            #[cfg(any(not(test), target_arch = "wasm32"))]
            let forced_control_io = false;
            let step = if forced_control_io {
                StepResult::IO
            } else {
                statement.step().map_err(TursoStorageError::turso)?
            };
            match step {
                StepResult::Done => break,
                StepResult::Row => {
                    let row = statement
                        .row()
                        .ok_or_else(|| TursoStorageError::reset(PhysicalResetReason::Corruption))?;
                    if !visit(row)? {
                        break;
                    }
                }
                StepResult::IO => {
                    #[cfg(all(test, not(target_arch = "wasm32")))]
                    record_control_io();
                    statement._io().step().map_err(TursoStorageError::turso)?
                }
                StepResult::Yield => statement._io().step().map_err(TursoStorageError::turso)?,
                StepResult::Busy => return Err(TursoStorageError::turso(LimboError::Busy)),
                StepResult::Interrupt => {
                    return Err(TursoStorageError::turso(LimboError::Interrupt));
                }
            }
        }
        Ok(statement.n_change())
    })();

    // Turso has no separate public finalize call. A checked reset releases the
    // active VM state and I/O before reuse or drop; dropping returns the
    // statement to its connection's cache, or releases it after a failure. Any
    // reset failure makes that cleanup and any surrounding transaction
    // unusable, regardless of the underlying class.
    let reset = checked_reset(statement);
    statement.clear_bindings();
    let result = match (execution, reset) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(RunFailure::execution(error)),
        (execution, Err(_)) => Err(RunFailure::cleanup(execution.is_ok())),
    };
    if let Some(timer) = timer {
        timer.finish(statement.get_sql(), result.is_ok());
    }
    result
}

fn checked_reset(statement: &mut Statement) -> Result<(), TursoStorageError> {
    let reset = statement
        .reset()
        .map_err(|_| TursoStorageError::reset(PhysicalResetReason::TransactionOutcomeUncertain));
    #[cfg(all(test, not(target_arch = "wasm32")))]
    if take_reset_failure(statement.get_sql()) {
        return Err(TursoStorageError::reset(
            PhysicalResetReason::TransactionOutcomeUncertain,
        ));
    }
    reset
}

pub(crate) fn read_transaction<T>(
    connection: &Db,
    operation: impl FnOnce() -> Result<T, TursoStorageError>,
) -> Result<T, TursoStorageError> {
    transaction(connection, "BEGIN", operation)
}

pub(crate) fn write_transaction<T>(
    connection: &Db,
    operation: impl FnOnce() -> Result<T, TursoStorageError>,
) -> Result<T, TursoStorageError> {
    // BEGIN IMMEDIATE eagerly initializes Turso's temp database, which reads
    // std::time::Instant and is unsupported in browser WASM. The connection is
    // cache-local and operations are serialized, so a deferred write
    // transaction provides the required atomicity without reserving the writer
    // lock before the first write statement.
    transaction(connection, "BEGIN", operation)
}

fn transaction<T>(
    connection: &Db,
    begin_sql: &str,
    operation: impl FnOnce() -> Result<T, TursoStorageError>,
) -> Result<T, TursoStorageError> {
    let begin = execute_control(connection, begin_sql, TestControlPhase::Begin);
    if let Err(failure) = begin {
        if failure.execution_completed && failure.cleanup_failed {
            let _ = execute_control(connection, "ROLLBACK", TestControlPhase::Rollback);
        }
        return Err(failure.error);
    }

    match operation() {
        Ok(value) => match execute_control(connection, "COMMIT", TestControlPhase::Commit) {
            Ok(_) => Ok(value),
            Err(_) => {
                let _ = execute_control(connection, "ROLLBACK", TestControlPhase::Rollback);
                Err(TursoStorageError::reset(
                    PhysicalResetReason::TransactionOutcomeUncertain,
                ))
            }
        },
        Err(error) => match execute_control(connection, "ROLLBACK", TestControlPhase::Rollback) {
            Ok(_) => Err(error),
            Err(_) => Err(TursoStorageError::reset(
                PhysicalResetReason::TransactionOutcomeUncertain,
            )),
        },
    }
}

fn execute_control(connection: &Db, sql: &str, phase: TestControlPhase) -> Result<i64, RunFailure> {
    #[cfg(all(test, not(target_arch = "wasm32")))]
    record_control_phase(phase);
    #[cfg(all(test, not(target_arch = "wasm32")))]
    let _phase_guard = TestControlPhaseGuard::enter(phase);
    #[cfg(any(not(test), target_arch = "wasm32"))]
    let _ = phase;
    let mut statement = prepare(connection, sql).map_err(RunFailure::execution)?;
    execute_prepared_detailed(&mut statement, Vec::new())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TestControlPhase {
    Begin,
    Commit,
    Rollback,
}

#[cfg(all(test, not(target_arch = "wasm32")))]
thread_local! {
    static RESET_FAILURE_SQL: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
    static CURRENT_CONTROL_PHASE: std::cell::Cell<Option<TestControlPhase>> = const { std::cell::Cell::new(None) };
    static CONTROL_TRACE: std::cell::RefCell<Vec<TestControlPhase>> = const { std::cell::RefCell::new(Vec::new()) };
    static CONTROL_IO_TRACE: std::cell::RefCell<Vec<TestControlPhase>> = const { std::cell::RefCell::new(Vec::new()) };
    static FORCE_CONTROL_IO: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(all(test, not(target_arch = "wasm32")))]
struct TestControlPhaseGuard {
    previous: Option<TestControlPhase>,
}

#[cfg(all(test, not(target_arch = "wasm32")))]
impl TestControlPhaseGuard {
    fn enter(phase: TestControlPhase) -> Self {
        let previous = CURRENT_CONTROL_PHASE.with(|current| current.replace(Some(phase)));
        Self { previous }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
impl Drop for TestControlPhaseGuard {
    fn drop(&mut self) {
        CURRENT_CONTROL_PHASE.with(|current| current.set(self.previous));
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
fn take_reset_failure(sql: &str) -> bool {
    RESET_FAILURE_SQL.with(|fault| {
        if fault.borrow().as_deref() == Some(sql) {
            fault.borrow_mut().take();
            true
        } else {
            false
        }
    })
}

#[cfg(all(test, not(target_arch = "wasm32")))]
fn record_control_phase(phase: TestControlPhase) {
    CONTROL_TRACE.with(|trace| trace.borrow_mut().push(phase));
}

#[cfg(all(test, not(target_arch = "wasm32")))]
fn take_forced_control_io() -> bool {
    current_test_control_phase() == Some(TestControlPhase::Rollback)
        && FORCE_CONTROL_IO.with(|forced| forced.replace(false))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
fn record_control_io() {
    if let Some(phase) = current_test_control_phase() {
        CONTROL_IO_TRACE.with(|trace| trace.borrow_mut().push(phase));
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
pub(crate) fn current_test_control_phase() -> Option<TestControlPhase> {
    CURRENT_CONTROL_PHASE.with(std::cell::Cell::get)
}

#[cfg(all(test, not(target_arch = "wasm32")))]
pub(crate) fn arm_reset_failure(sql: &str) {
    RESET_FAILURE_SQL.with(|fault| *fault.borrow_mut() = Some(sql.to_owned()));
}

#[cfg(all(test, not(target_arch = "wasm32")))]
pub(crate) fn arm_rollback_control_io() {
    FORCE_CONTROL_IO.with(|forced| forced.set(true));
}

#[cfg(all(test, not(target_arch = "wasm32")))]
pub(crate) fn clear_control_trace() {
    CONTROL_TRACE.with(|trace| trace.borrow_mut().clear());
    CONTROL_IO_TRACE.with(|trace| trace.borrow_mut().clear());
    FORCE_CONTROL_IO.with(|forced| forced.set(false));
}

#[cfg(all(test, not(target_arch = "wasm32")))]
pub(crate) fn take_control_trace() -> Vec<TestControlPhase> {
    CONTROL_TRACE.with(|trace| std::mem::take(&mut *trace.borrow_mut()))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
pub(crate) fn take_control_io_trace() -> Vec<TestControlPhase> {
    CONTROL_IO_TRACE.with(|trace| std::mem::take(&mut *trace.borrow_mut()))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
