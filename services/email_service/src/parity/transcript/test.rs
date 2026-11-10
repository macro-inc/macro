use super::*;
use serde_json::json;

#[test]
fn sql_is_shared_by_content_and_executions_keep_order_and_counts() {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut transcript = Transcript::new("test", "sql", Normalizer::default());
    transcript.step(
        "query",
        vec![(
            "sql",
            json!({
                "statements":[{"id":1,"sql":"SELECT 1"},{"id":2,"sql":"SELECT  1\n"}],
                "sequence":[{"statement":2,"rows_affected":0,"rows_returned":1},
                            {"statement":1,"rows_affected":2,"rows_returned":0}]
            }),
        )],
    );
    assert_eq!(
        transcript.take(),
        "step: query\nsql:\n  a0a22c9dfa42 rows_affected=0 rows_returned=1\n  a0a22c9dfa42 rows_affected=2 rows_returned=0\n\n"
    );
    assert_eq!(
        transcript.statements,
        BTreeMap::from([("a0a22c9dfa42".into(), "SELECT 1\n".into())])
    );
}

#[test]
fn concurrent_statement_publication_is_complete_and_never_overwrites() {
    if !crate::parity::process_per_test() {
        return;
    }
    let directory = std::env::temp_dir().join(format!("parity-sql-{}", uuid::Uuid::now_v7()));
    let sql = format!("SELECT '{}'\n", "large statement".repeat(10_000));
    let id = statement_id(&sql);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let directory = directory.clone();
            let sql = sql.clone();
            let id = id.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                write_statement(&directory, &id, &sql, true);
            })
        })
        .collect();
    for thread in threads {
        thread.join().expect("concurrent statement writer");
    }
    write_statement(&directory, &id, &sql, false);
    assert!(
        std::panic::catch_unwind(|| write_statement(&directory, &id, "different\n", true)).is_err()
    );
    write_statement(&directory, &id, &sql, false);
    assert_eq!(
        std::fs::read_dir(directory.join("sql"))
            .expect("SQL directory")
            .count(),
        1
    );
    std::fs::remove_dir_all(directory).expect("remove SQL test fixture");
}

#[test]
fn sql_orphan_check_rejects_unreferenced_and_missing_statements() {
    if !crate::parity::process_per_test() {
        return;
    }
    let directory = std::env::temp_dir().join(format!("parity-sql-{}", uuid::Uuid::now_v7()));
    let sql = "SELECT 1\n";
    let id = statement_id(sql);
    write_statement(&directory, &id, sql, true);
    assert_sql_references(&directory, BTreeSet::from([id]));
    assert!(
        std::panic::catch_unwind(|| assert_sql_references(&directory, BTreeSet::new())).is_err()
    );
    assert!(
        std::panic::catch_unwind(|| assert_sql_references(
            &directory,
            BTreeSet::from(["missing".into()])
        ))
        .is_err()
    );
    std::fs::remove_dir_all(directory).expect("remove SQL test fixture");
}
