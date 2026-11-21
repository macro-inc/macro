use super::*;
use turso_core::{Database, MemoryIO, OpenOptions, SqliteDialect};

fn memory_db(name: &str) -> Db {
    let database = Database::open(
        Arc::new(MemoryIO::new()),
        name,
        OpenOptions::new(Arc::new(SqliteDialect)),
    )
    .unwrap();
    Db::cached(database.connect().unwrap())
}

const INSERT: &str = "INSERT INTO t (id, label) VALUES (?1, ?2)";
const SELECT: &str = "SELECT id, label FROM t WHERE id >= ?1 ORDER BY id";

fn setup(name: &str) -> Db {
    let db = memory_db(name);
    execute(
        &db,
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
        vec![],
    )
    .unwrap();
    db
}

fn ids(rows: &Rows) -> Vec<i64> {
    rows.iter()
        .map(|row| match row[0] {
            Value::Numeric(turso_core::Numeric::Integer(id)) => id,
            ref other => panic!("unexpected id {other:?}"),
        })
        .collect()
}

#[test]
fn reused_statements_rebind_and_return_fresh_rows() {
    let db = setup("statement-cache-reuse.db");
    for id in 0..5 {
        execute(
            &db,
            INSERT,
            vec![Value::from_i64(id), Value::build_text(format!("row {id}"))],
        )
        .unwrap();
    }
    assert_eq!(db.cached_copies(INSERT), 1);
    assert_eq!(
        ids(&query(&db, SELECT, vec![Value::from_i64(3)]).unwrap()),
        [3, 4]
    );
    assert_eq!(
        ids(&query(&db, SELECT, vec![Value::from_i64(1)]).unwrap()),
        [1, 2, 3, 4]
    );
    assert_eq!(db.cached_copies(SELECT), 1);
}

#[test]
fn a_reused_statement_starts_with_no_bindings_or_metrics() {
    let db = setup("statement-cache-bindings.db");
    execute(
        &db,
        INSERT,
        vec![Value::from_i64(1), Value::build_text("one")],
    )
    .unwrap();
    query(&db, SELECT, vec![Value::from_i64(0)]).unwrap();
    query(&db, SELECT, vec![Value::from_i64(0)]).unwrap();
    assert_eq!(db.cached_copies(SELECT), 1);
    let statement = prepare(&db, SELECT).unwrap();
    assert_eq!(
        db.cached_copies(SELECT),
        0,
        "the cached statement was taken"
    );
    assert_eq!(statement.metrics().insn_executed, 0);
    drop(statement);
    // Too few values fails before binding rather than reusing the last ones.
    assert!(query(&db, SELECT, vec![]).is_err());
    assert_eq!(db.cached_copies(SELECT), 0, "a failed run is not kept");
    assert_eq!(
        ids(&query(&db, SELECT, vec![Value::from_i64(0)]).unwrap()),
        [1]
    );
}

#[test]
fn a_text_running_inside_itself_gets_its_own_statement() {
    let db = setup("statement-cache-nested.db");
    for id in 0..3 {
        execute(
            &db,
            INSERT,
            vec![Value::from_i64(id), Value::build_text("x")],
        )
        .unwrap();
    }
    let mut outer = Vec::new();
    query_each(&db, SELECT, vec![Value::from_i64(0)], |row| {
        let inner = query(&db, SELECT, vec![row.get_value(0).clone()])?;
        outer.push(inner.len());
        Ok(())
    })
    .unwrap();
    assert_eq!(outer, [3, 2, 1]);
    assert_eq!(db.cached_copies(SELECT), 2);
    let held: Vec<_> = (0..4).map(|_| prepare(&db, SELECT).unwrap()).collect();
    drop(held);
    assert_eq!(db.cached_copies(SELECT), CACHED_COPIES_PER_TEXT);
}

#[test]
fn a_cached_statement_follows_schema_changes() {
    let db = setup("statement-cache-schema.db");
    execute(
        &db,
        INSERT,
        vec![Value::from_i64(1), Value::build_text("one")],
    )
    .unwrap();
    let all = "SELECT * FROM t";
    query(&db, all, vec![]).unwrap();
    assert_eq!(query(&db, all, vec![]).unwrap()[0].len(), 2);
    assert_eq!(db.cached_copies(all), 1);
    execute(
        &db,
        "ALTER TABLE t ADD COLUMN extra INTEGER NOT NULL DEFAULT 7",
        vec![],
    )
    .unwrap();
    let rows = query(&db, all, vec![]).unwrap();
    assert_eq!(rows[0].len(), 3);
    assert_eq!(rows[0][2], Value::from_i64(7));
}

#[test]
fn a_statement_that_fails_is_not_kept() {
    let db = setup("statement-cache-failure.db");
    for id in [0, 1] {
        execute(
            &db,
            INSERT,
            vec![Value::from_i64(id), Value::build_text("one")],
        )
        .unwrap();
    }
    assert_eq!(db.cached_copies(INSERT), 1);
    assert!(
        execute(
            &db,
            INSERT,
            vec![Value::from_i64(1), Value::build_text("dup")]
        )
        .is_err()
    );
    assert_eq!(db.cached_copies(INSERT), 0);
    execute(
        &db,
        INSERT,
        vec![Value::from_i64(2), Value::build_text("two")],
    )
    .unwrap();
    assert_eq!(
        ids(&query(&db, SELECT, vec![Value::from_i64(0)]).unwrap()),
        [0, 1, 2]
    );
}

#[test]
fn a_reset_failure_is_not_kept() {
    let db = setup("statement-cache-reset-failure.db");
    // The second use keeps a copy, so the failure hits a cached statement.
    for _ in 0..2 {
        query(&db, SELECT, vec![Value::from_i64(0)]).unwrap();
    }
    assert_eq!(db.cached_copies(SELECT), 1);
    arm_reset_failure(SELECT);
    assert!(query(&db, SELECT, vec![Value::from_i64(0)]).is_err());
    assert_eq!(db.cached_copies(SELECT), 0);
}

#[test]
fn texts_beyond_the_bound_evict_the_least_recently_used() {
    let db = setup("statement-cache-bound.db");
    let text = |n: usize| format!("SELECT id FROM t WHERE id = {n}");
    let twice = |n: usize| {
        for _ in 0..2 {
            query(&db, &text(n), vec![]).unwrap();
        }
    };
    for n in 0..CACHED_STATEMENT_TEXTS {
        twice(n);
    }
    // Touch the first so the second is now the oldest.
    query(&db, &text(0), vec![]).unwrap();
    twice(CACHED_STATEMENT_TEXTS);
    assert_eq!(db.cached_texts(), CACHED_STATEMENT_TEXTS);
    assert_eq!(db.cached_copies(&text(0)), 1);
    assert_eq!(db.cached_copies(&text(1)), 0);
    assert_eq!(db.cached_copies(&text(CACHED_STATEMENT_TEXTS)), 1);
}

#[test]
fn transactions_commit_and_roll_back_through_cached_statements() {
    let db = setup("statement-cache-transactions.db");
    write_transaction(&db, || {
        execute(
            &db,
            INSERT,
            vec![Value::from_i64(1), Value::build_text("one")],
        )
        .map(|_| ())
    })
    .unwrap();
    // Each control text runs twice, so it is kept from its second use.
    for _ in 0..2 {
        let failed: Result<(), _> = write_transaction(&db, || {
            execute(
                &db,
                INSERT,
                vec![Value::from_i64(2), Value::build_text("two")],
            )?;
            Err(TursoStorageError::Database)
        });
        assert!(failed.is_err());
    }
    let rows = read_transaction(&db, || query(&db, SELECT, vec![Value::from_i64(0)])).unwrap();
    assert_eq!(ids(&rows), [1]);
    assert_eq!(db.cached_copies("BEGIN"), 1);
    assert_eq!(db.cached_copies("COMMIT"), 1);
    assert_eq!(db.cached_copies("ROLLBACK"), 1);
}

#[test]
fn releasing_statements_returns_every_connection_reference() {
    let db = setup("statement-cache-release.db");
    for _ in 0..2 {
        query(&db, SELECT, vec![Value::from_i64(0)]).unwrap();
    }
    assert!(Arc::strong_count(&db) > 1);
    db.release_statements();
    assert_eq!(db.cached_texts(), 0);
    assert_eq!(Arc::strong_count(&db), 1);
    db.close().unwrap();
}

#[test]
fn a_text_is_kept_only_from_its_second_use() {
    let db = setup("statement-cache-admission.db");
    query(&db, SELECT, vec![Value::from_i64(0)]).unwrap();
    assert_eq!(db.cached_copies(SELECT), 0, "a text run once is not kept");
    query(&db, SELECT, vec![Value::from_i64(0)]).unwrap();
    assert_eq!(db.cached_copies(SELECT), 1);
    let once = |n: usize| format!("SELECT id FROM t WHERE id IN ({n})");
    for n in 0..CACHED_STATEMENT_TEXTS * 2 {
        query(&db, &once(n), vec![]).unwrap();
    }
    assert_eq!(db.cached_texts(), 1, "one-off texts take no slot");
    assert_eq!(db.cached_copies(SELECT), 1);
}
