use super::*;
use std::cell::Cell;

#[derive(Default)]
struct TestTelemetry {
    now: Cell<f64>,
    events: RefCell<Vec<(String, f64, bool)>>,
}

impl QueryTelemetry for TestTelemetry {
    fn now_ms(&self) -> f64 {
        self.now.get()
    }

    fn slow_query(&self, fingerprint: &str, duration_ms: f64, success: bool) {
        self.events
            .borrow_mut()
            .push((fingerprint.to_owned(), duration_ms, success));
    }
}

struct ResetTelemetry;

impl Drop for ResetTelemetry {
    fn drop(&mut self) {
        set_query_telemetry(None);
    }
}

#[test]
fn reports_only_executions_strictly_over_200_ms_with_finite_clocks() {
    let telemetry = Rc::new(TestTelemetry::default());
    set_query_telemetry(Some(telemetry.clone()));
    let _reset = ResetTelemetry;
    for duration in [0.0, 199.0, 200.0, 200.1, -1.0, f64::NAN, f64::INFINITY] {
        telemetry.now.set(10.0);
        let timer = QueryTimer::start().unwrap();
        telemetry.now.set(10.0 + duration);
        timer.finish("SELECT ?", true);
    }
    assert_eq!(
        telemetry.events.borrow().as_slice(),
        [(fingerprint("SELECT ?"), 200.1, true)]
    );
}

#[test]
fn fingerprint_is_stable_and_does_not_export_sql() {
    // Known FNV-1a vector, also fixes the representation across Rust versions.
    assert_eq!(fingerprint("hello"), "a430d84680aabd0b");
    assert_eq!(fingerprint("SELECT ?").len(), 16);
    assert_ne!(fingerprint("SELECT ?"), fingerprint("DELETE FROM records"));
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn driver_times_reused_statements_and_failures_without_bound_values() {
    use std::sync::Arc;
    use turso_core::{Database, MemoryIO, OpenOptions, SqliteDialect, Value};

    struct AdvancingTelemetry(TestTelemetry);
    impl QueryTelemetry for AdvancingTelemetry {
        fn now_ms(&self) -> f64 {
            let now = self.0.now.get();
            self.0.now.set(now + 201.0);
            now
        }
        fn slow_query(&self, fingerprint: &str, duration_ms: f64, success: bool) {
            self.0.slow_query(fingerprint, duration_ms, success);
        }
    }

    let database = Database::open(
        Arc::new(MemoryIO::new()),
        "query-telemetry.db",
        OpenOptions::new(Arc::new(SqliteDialect)),
    )
    .unwrap();
    let connection = crate::driver::Db::cached(database.connect().unwrap());
    let mut statement = crate::driver::prepare(&connection, "SELECT ?").unwrap();
    let telemetry = Rc::new(AdvancingTelemetry(TestTelemetry::default()));
    set_query_telemetry(Some(telemetry.clone()));
    let _reset = ResetTelemetry;

    for value in ["private-first", "private-second"] {
        let rows = crate::driver::query_prepared(&mut statement, vec![Value::from_text(value)]);
        assert!(rows.is_ok());
    }
    assert!(crate::driver::query_prepared(&mut statement, vec![]).is_err());
    crate::driver::query_each(
        &connection,
        "SELECT ?",
        vec![Value::from_text("private-streamed")],
        |_| Ok(()),
    )
    .unwrap();
    assert!(
        crate::driver::query_each(
            &connection,
            "SELECT ?",
            vec![Value::from_text("private-failure")],
            |_| Err(crate::TursoStorageError::InvalidInput)
        )
        .is_err()
    );
    assert_eq!(
        telemetry.0.events.borrow().as_slice(),
        [
            (fingerprint("SELECT ?"), 201.0, true),
            (fingerprint("SELECT ?"), 201.0, true),
            (fingerprint("SELECT ?"), 201.0, false),
            (fingerprint("SELECT ?"), 201.0, true),
            (fingerprint("SELECT ?"), 201.0, false),
        ]
    );

    set_query_telemetry(None);
    assert!(QueryTimer::start().is_none());
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn driver_counts_every_execution_and_stepped_row_without_a_sink() {
    use std::sync::Arc;
    use turso_core::{Database, MemoryIO, OpenOptions, SqliteDialect, Value};

    let database = Database::open(
        Arc::new(MemoryIO::new()),
        "sql-counts.db",
        OpenOptions::new(Arc::new(SqliteDialect)),
    )
    .unwrap();
    let connection = crate::driver::Db::cached(database.connect().unwrap());
    let before = sql_counts();
    let mut statement = crate::driver::prepare(
        &connection,
        "SELECT value FROM (SELECT 1 AS value UNION ALL SELECT 2 UNION ALL SELECT 3) WHERE value >= ?",
    )
    .unwrap();
    let rows = crate::driver::query_prepared(&mut statement, vec![Value::from_i64(2)]).unwrap();
    assert_eq!(rows.len(), 2);
    let rows = crate::driver::query_prepared(&mut statement, vec![Value::from_i64(1)]).unwrap();
    assert_eq!(rows.len(), 3);
    let mut seen = 0;
    crate::driver::query_each(&connection, "SELECT 1 UNION ALL SELECT 2", vec![], |_| {
        seen += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(seen, 2);
    // A refused bind counts as an execution that stepped no row.
    assert!(crate::driver::query_prepared(&mut statement, vec![]).is_err());

    let after = sql_counts();
    assert_eq!(after.statements - before.statements, 4);
    assert_eq!(after.rows - before.rows, 2 + 3 + 2);
}
