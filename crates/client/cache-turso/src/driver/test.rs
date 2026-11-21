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

fn connection_pair(name: &str) -> (Db, Db) {
    let database = Database::open(
        Arc::new(MemoryIO::new()),
        name,
        OpenOptions::new(Arc::new(SqliteDialect)),
    )
    .unwrap();
    let writer = Db::cached(database.connect().unwrap());
    execute(
        &writer,
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
        vec![],
    )
    .unwrap();
    (writer, Db::cached(database.connect().unwrap()))
}

fn write_pages(db: &Db, from: i64, rows: i64) {
    write_transaction(db, || {
        for id in from..from + rows {
            execute(
                db,
                INSERT,
                vec![Value::from_i64(id), Value::build_text("x".repeat(3_000))],
            )?;
        }
        Ok(())
    })
    .unwrap();
}

fn wal_frames(db: &Db) -> u64 {
    db.connection.wal_state().unwrap().max_frame
}

#[test]
fn an_idle_checkpoint_lets_the_next_write_restart_the_log() {
    let (writer, _reader) = connection_pair("checkpoint-restart.db");
    write_pages(&writer, 0, 40);
    assert_eq!(
        writer.checkpoint_over(u64::MAX).unwrap(),
        WalCheckpoint {
            ran: false,
            wal_frames: wal_frames(&writer),
            backfilled_frames: 0
        },
        "not due"
    );
    let copied = writer.checkpoint_over(1).unwrap();
    assert!(copied.ran, "{copied:?}");
    assert_eq!(copied.backfilled_frames, copied.wal_frames, "{copied:?}");

    // Every frame is in the database file, so Turso starts the log over.
    write_pages(&writer, 40, 1);
    assert!(wal_frames(&writer) < copied.wal_frames / 4);
}

#[test]
fn a_reader_on_another_connection_holds_back_the_restart_until_it_ends() {
    let (writer, reader) = connection_pair("checkpoint-reader.db");
    write_pages(&writer, 0, 40);
    execute(&reader, "BEGIN", vec![]).unwrap();
    let rows = query(&reader, "SELECT count(*) FROM t", vec![]).unwrap();
    assert_eq!(rows[0][0], Value::from_i64(40));

    // The reader's snapshot holds every frame, so all of them are copied,
    // but the log cannot start over beneath the reader.
    let pinned = writer.checkpoint_over(1).unwrap();
    assert!(pinned.ran, "{pinned:?}");
    assert_eq!(pinned.backfilled_frames, pinned.wal_frames, "{pinned:?}");
    write_pages(&writer, 40, 5);
    assert!(wal_frames(&writer) > pinned.wal_frames);

    execute(&reader, "COMMIT", vec![]).unwrap();
    let released = writer.checkpoint_over(1).unwrap();
    assert!(released.ran, "{released:?}");
    assert_eq!(
        released.backfilled_frames,
        released.wal_frames - pinned.wal_frames
    );
    write_pages(&writer, 45, 1);
    assert!(wal_frames(&writer) < pinned.wal_frames / 4);
    let rows =
        read_transaction(&writer, || query(&writer, "SELECT count(*) FROM t", vec![])).unwrap();
    assert_eq!(rows[0][0], Value::from_i64(46));
}

#[test]
fn a_write_open_on_another_connection_does_not_hold_back_the_copy() {
    let (writer, other) = connection_pair("checkpoint-writer.db");
    write_pages(&writer, 0, 40);
    execute(&other, "BEGIN IMMEDIATE", vec![]).unwrap();
    execute(
        &other,
        INSERT,
        vec![Value::from_i64(100), Value::build_text("y".to_owned())],
    )
    .unwrap();

    // A passive copy never waits for a writer: it copies every committed frame.
    let copied = writer.checkpoint_over(1).unwrap();
    assert!(copied.ran, "{copied:?}");
    assert_eq!(copied.backfilled_frames, copied.wal_frames, "{copied:?}");

    execute(&other, "COMMIT", vec![]).unwrap();
    // The writer sees the other commit from its next transaction on; until
    // then its view of the WAL is the one it already copied.
    assert!(!writer.checkpoint_over(1).unwrap().ran);
    let rows =
        read_transaction(&writer, || query(&writer, "SELECT count(*) FROM t", vec![])).unwrap();
    assert_eq!(rows[0][0], Value::from_i64(41));
    let later = writer.checkpoint_over(1).unwrap();
    assert!(later.ran && later.backfilled_frames >= 1, "{later:?}");
}

#[test]
fn a_copy_held_back_by_a_reader_runs_again_once_the_reader_ends() {
    let (writer, reader) = connection_pair("checkpoint-partial.db");
    write_pages(&writer, 0, 40);
    execute(&reader, "BEGIN", vec![]).unwrap();
    query(&reader, "SELECT count(*) FROM t", vec![]).unwrap();
    write_pages(&writer, 40, 10);

    // The reader's snapshot ends before the last write's frames.
    let partial = writer.checkpoint_over(1).unwrap();
    assert!(partial.ran, "{partial:?}");
    assert!(
        partial.backfilled_frames < partial.wal_frames,
        "{partial:?}"
    );

    execute(&reader, "COMMIT", vec![]).unwrap();
    let rest = writer.checkpoint_over(1).unwrap();
    assert!(rest.ran, "{rest:?}");
    assert_eq!(
        rest.backfilled_frames,
        rest.wal_frames - partial.backfilled_frames,
        "{rest:?}"
    );
}

#[test]
fn a_copy_through_a_stale_view_remembers_the_frames_it_copied() {
    let (a, b) = connection_pair("checkpoint-stale.db");
    write_pages(&a, 0, 40);
    let first = a.checkpoint_over(1).unwrap();
    assert_eq!(first.backfilled_frames, first.wal_frames, "{first:?}");

    // `b` starts the log over and keeps its write open; `a` still sees the
    // frame count of the log before.
    write_pages(&b, 40, 1);
    execute(&b, "BEGIN IMMEDIATE", vec![]).unwrap();
    execute(&b, "UPDATE t SET label = 'y' WHERE id = 0", vec![]).unwrap();
    let stale = a.checkpoint_over(1).unwrap();
    assert!(stale.ran, "{stale:?}");
    assert_eq!(stale.wal_frames, first.wal_frames, "a's view is stale");
    assert!(stale.backfilled_frames < first.wal_frames, "{stale:?}");

    // `b` commits into the same log, one frame at a time, up to the count
    // `a` saw before the restart.
    execute(&b, "COMMIT", vec![]).unwrap();
    for label in 0..first.wal_frames {
        if wal_frames(&b) >= first.wal_frames {
            break;
        }
        execute(
            &b,
            "UPDATE t SET label = ? WHERE id = 0",
            vec![Value::build_text(label.to_string())],
        )
        .unwrap();
    }
    assert_eq!(wal_frames(&b), first.wal_frames);

    read_transaction(&a, || query(&a, "SELECT count(*) FROM t", vec![])).unwrap();
    let pending = a.checkpoint_over(1).unwrap();
    assert!(
        pending.ran && pending.backfilled_frames > 0,
        "frames {b_frames} were never copied: {pending:?}",
        b_frames = wal_frames(&b)
    );
}

#[test]
fn a_reader_on_the_database_file_makes_the_copy_busy_until_it_ends() {
    let (writer, reader) = connection_pair("checkpoint-busy.db");
    write_pages(&writer, 0, 40);
    let copied = writer.checkpoint_over(1).unwrap();
    assert_eq!(copied.backfilled_frames, copied.wal_frames, "{copied:?}");

    // Every frame is copied, so the reader reads the database file alone and
    // the writer cannot start the log over beneath it.
    execute(&reader, "BEGIN", vec![]).unwrap();
    query(&reader, "SELECT count(*) FROM t", vec![]).unwrap();
    write_pages(&writer, 40, 5);
    let busy = writer.checkpoint_over(1).unwrap();
    assert_eq!(
        busy,
        WalCheckpoint {
            ran: false,
            wal_frames: wal_frames(&writer),
            backfilled_frames: 0
        }
    );

    execute(&reader, "COMMIT", vec![]).unwrap();
    let rest = writer.checkpoint_over(1).unwrap();
    assert!(rest.ran, "{rest:?}");
    assert_eq!(
        rest.backfilled_frames,
        rest.wal_frames - copied.wal_frames,
        "{rest:?}"
    );
}

#[test]
fn an_idle_checkpoint_keeps_the_page_cache() {
    let (writer, _reader) = connection_pair("checkpoint-cache.db");
    write_pages(&writer, 0, 40);
    let rows = read_transaction(&writer, || {
        query(&writer, "SELECT sum(length(label)) FROM t", vec![])
    })
    .unwrap();
    assert_eq!(rows[0][0], Value::from_i64(40 * 3_000));
    let pager = writer.connection.get_pager();
    let cached = || {
        (1..=40)
            .filter(|page| pager.cache_get(*page).unwrap().is_some())
            .count()
    };
    let before = cached();
    assert!(before >= 30, "{before} pages cached");

    let copied = writer.checkpoint_over(1).unwrap();
    assert_eq!(copied.backfilled_frames, copied.wal_frames, "{copied:?}");
    assert_eq!(cached(), before, "the copy leaves cached pages in place");
    let rows = read_transaction(&writer, || {
        query(&writer, "SELECT sum(length(label)) FROM t", vec![])
    })
    .unwrap();
    assert_eq!(rows[0][0], Value::from_i64(40 * 3_000));
}
