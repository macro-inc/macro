use crate::{PhysicalResetReason, TursoStorageError};
use std::num::NonZeroUsize;
use std::sync::Arc;
use turso_core::{Connection, LimboError, Statement, StepResult, Value};

pub(crate) type Values = Vec<Value>;
pub(crate) type Rows = Vec<Values>;

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

pub(crate) fn prepare(
    connection: &Arc<Connection>,
    sql: &str,
) -> Result<Statement, TursoStorageError> {
    connection.prepare(sql).map_err(TursoStorageError::turso)
}

pub(crate) fn validate(connection: &Arc<Connection>, sql: &str) -> Result<(), TursoStorageError> {
    let mut statement = prepare(connection, sql)?;
    checked_reset(&mut statement)?;
    statement.clear_bindings();
    Ok(())
}

pub(crate) fn execute(
    connection: &Arc<Connection>,
    sql: &str,
    values: Values,
) -> Result<i64, TursoStorageError> {
    let mut statement = prepare(connection, sql)?;
    execute_prepared(&mut statement, values)
}

pub(crate) fn query(
    connection: &Arc<Connection>,
    sql: &str,
    values: Values,
) -> Result<Rows, TursoStorageError> {
    let mut statement = prepare(connection, sql)?;
    query_prepared(&mut statement, values)
}

pub(crate) fn execute_prepared(
    statement: &mut Statement,
    values: Values,
) -> Result<i64, TursoStorageError> {
    execute_prepared_detailed(statement, values).map_err(|failure| failure.error)
}

fn execute_prepared_detailed(statement: &mut Statement, values: Values) -> Result<i64, RunFailure> {
    let (rows, changed) = run_prepared(statement, values)?;
    if rows.is_empty() {
        Ok(changed)
    } else {
        Err(RunFailure::execution(TursoStorageError::Database))
    }
}

pub(crate) fn query_prepared(
    statement: &mut Statement,
    values: Values,
) -> Result<Rows, TursoStorageError> {
    run_prepared(statement, values)
        .map(|(rows, _)| rows)
        .map_err(|failure| failure.error)
}

fn run_prepared(statement: &mut Statement, values: Values) -> Result<(Rows, i64), RunFailure> {
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

        let mut rows = Vec::new();
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
                    rows.push(row.get_values().cloned().collect());
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
        Ok((rows, statement.n_change()))
    })();

    // Turso has no separate public finalize call. A checked reset releases the
    // active VM state and I/O before reuse or drop; dropping then releases the
    // prepared statement itself. Any reset failure makes that cleanup and any
    // surrounding transaction unusable, regardless of the underlying class.
    let reset = checked_reset(statement);
    statement.clear_bindings();
    match (execution, reset) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(RunFailure::execution(error)),
        (execution, Err(_)) => Err(RunFailure::cleanup(execution.is_ok())),
    }
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
    connection: &Arc<Connection>,
    operation: impl FnOnce() -> Result<T, TursoStorageError>,
) -> Result<T, TursoStorageError> {
    transaction(connection, "BEGIN", operation)
}

pub(crate) fn write_transaction<T>(
    connection: &Arc<Connection>,
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
    connection: &Arc<Connection>,
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

fn execute_control(
    connection: &Arc<Connection>,
    sql: &str,
    phase: TestControlPhase,
) -> Result<i64, RunFailure> {
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
