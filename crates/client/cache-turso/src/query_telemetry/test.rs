use super::*;
use crate::sql::{Sql, Template, UnreportedSql};
use std::cell::Cell;

type Event = (String, f64, bool, Option<String>);

#[derive(Default)]
struct TestTelemetry {
    now: Cell<f64>,
    events: RefCell<Vec<Event>>,
}

impl QueryTelemetry for TestTelemetry {
    fn now_ms(&self) -> f64 {
        self.now.get()
    }

    fn slow_query(
        &self,
        fingerprint: &str,
        duration_ms: f64,
        success: bool,
        template: Option<&str>,
    ) {
        self.events.borrow_mut().push((
            fingerprint.to_owned(),
            duration_ms,
            success,
            template.map(str::to_owned),
        ));
    }
}

struct ResetTelemetry;

impl Drop for ResetTelemetry {
    fn drop(&mut self) {
        set_query_telemetry(None);
    }
}

fn install() -> (Rc<TestTelemetry>, ResetTelemetry) {
    let telemetry = Rc::new(TestTelemetry::default());
    set_query_telemetry(Some(telemetry.clone()));
    (telemetry, ResetTelemetry)
}

/// Finishes a timer that took 201 ms over `template`.
fn slow<'s>(telemetry: &TestTelemetry, template: impl Into<Template<'s>>) {
    let template = template.into();
    telemetry.now.set(0.0);
    let timer = QueryTimer::start().unwrap();
    telemetry.now.set(201.0);
    timer.finish(template.text(), template.reportable(), true);
}

#[test]
fn reports_only_executions_strictly_over_200_ms_with_finite_clocks() {
    let (telemetry, _reset) = install();
    for duration in [0.0, 199.0, 200.0, 200.1, -1.0, f64::NAN, f64::INFINITY] {
        telemetry.now.set(10.0);
        let timer = QueryTimer::start().unwrap();
        telemetry.now.set(10.0 + duration);
        timer.finish("SELECT ?", Template::from("SELECT ?").reportable(), true);
    }
    assert_eq!(
        telemetry.events.borrow().as_slice(),
        [(
            fingerprint("SELECT ?"),
            200.1,
            true,
            Some("SELECT ?".to_owned())
        )]
    );
}

#[test]
fn fingerprint_is_stable_and_does_not_export_sql() {
    // Known FNV-1a vectors, also fixing the representation across Rust
    // versions. COMMIT's is the one production slow_query logs carry.
    assert_eq!(fingerprint("hello"), "a430d84680aabd0b");
    assert_eq!(fingerprint("COMMIT"), "92389d1ea869911c");
    assert_eq!(fingerprint("SELECT ?").len(), 16);
    assert_ne!(fingerprint("SELECT ?"), fingerprint("DELETE FROM records"));
}

#[test]
fn sends_a_template_once_per_fingerprint_and_never_unreported_text() {
    let (telemetry, _reset) = install();
    let template = crate::sql!(
        "SELECT id FROM t WHERE id IN ({ids})",
        ids = Sql::placeholders(3)
    );
    slow(&telemetry, &template);
    slow(&telemetry, &template);
    let unreported = UnreportedSql::new("VACUUM INTO '/private/canary-path'".to_owned());
    slow(&telemetry, &unreported);
    slow(&telemetry, &unreported);
    let events = telemetry.events.borrow();
    let texts = events
        .iter()
        .map(|(hash, _, _, text)| (hash.as_str(), text.as_deref()))
        .collect::<Vec<_>>();
    let unreported_hash = fingerprint("VACUUM INTO '/private/canary-path'");
    assert_eq!(
        texts,
        [
            (
                fingerprint("SELECT id FROM t WHERE id IN (?, ?, ?)").as_str(),
                Some("SELECT id FROM t WHERE id IN (?, ?, ?)")
            ),
            (
                fingerprint("SELECT id FROM t WHERE id IN (?, ?, ?)").as_str(),
                None
            ),
            (unreported_hash.as_str(), None),
            (unreported_hash.as_str(), None),
        ]
    );
}

#[test]
fn reinstalling_telemetry_sends_templates_again() {
    let (telemetry, _reset) = install();
    slow(&telemetry, "COMMIT");
    let (again, _reset) = install();
    slow(&again, "COMMIT");
    assert_eq!(telemetry.events.borrow()[0].3.as_deref(), Some("COMMIT"));
    assert_eq!(again.events.borrow()[0].3.as_deref(), Some("COMMIT"));
}

#[test]
fn long_templates_keep_head_and_tail_within_the_bound() {
    let (telemetry, _reset) = install();
    let template = crate::sql!(
        "SELECT value FROM records WHERE id IN ({ids}) ORDER BY id",
        ids = Sql::placeholders(4_000)
    );
    assert!(template.as_str().len() > SLOW_QUERY_TEMPLATE_BYTES);
    slow(&telemetry, &template);
    let events = telemetry.events.borrow();
    let (hash, _, _, text) = &events[0];
    let text = text.as_deref().unwrap();
    assert_eq!(hash, &fingerprint(template.as_str()), "hashed unbounded");
    assert!(text.len() <= SLOW_QUERY_TEMPLATE_BYTES, "{}", text.len());
    assert!(text.starts_with("SELECT value FROM records WHERE id IN (?, ?"));
    assert!(text.ends_with("?, ?) ORDER BY id"));
    assert!(text.contains(&format!(" /* {} bytes */ ", template.as_str().len())));
}

#[test]
fn the_sent_set_is_bounded() {
    let (telemetry, _reset) = install();
    let texts = (0..=SENT_TEMPLATES)
        .map(|count| crate::sql!("SELECT {list}", list = Sql::placeholders(count + 1)))
        .collect::<Vec<_>>();
    let (last, within) = texts.split_last().unwrap();
    for text in within {
        slow(&telemetry, text);
    }
    // Every one of the first SENT_TEMPLATES texts is still remembered.
    slow(&telemetry, &texts[0]);
    slow(&telemetry, last);
    SENT.with(|sent| assert!(sent.borrow().len() <= SENT_TEMPLATES));
    // The set started over, so the first text is sent again.
    slow(&telemetry, &texts[0]);
    let events = telemetry.events.borrow();
    let sent: Vec<_> = events.iter().map(|event| event.3.is_some()).collect();
    let mut expected = vec![true; SENT_TEMPLATES];
    expected.extend([false, true, true]);
    assert_eq!(sent, expected);
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
        fn slow_query(
            &self,
            fingerprint: &str,
            duration_ms: f64,
            success: bool,
            template: Option<&str>,
        ) {
            self.0
                .slow_query(fingerprint, duration_ms, success, template);
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
    let template = Some("SELECT ?".to_owned());
    assert_eq!(
        telemetry.0.events.borrow().as_slice(),
        [
            (fingerprint("SELECT ?"), 201.0, true, template),
            (fingerprint("SELECT ?"), 201.0, true, None),
            (fingerprint("SELECT ?"), 201.0, false, None),
            (fingerprint("SELECT ?"), 201.0, true, None),
            (fingerprint("SELECT ?"), 201.0, false, None),
        ]
    );

    set_query_telemetry(None);
    assert!(QueryTimer::start().is_none());
}
