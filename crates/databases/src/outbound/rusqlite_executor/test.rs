use std::time::Duration;

use model_entity::EntityType;
use uuid::Uuid;

use super::*;
use crate::domain::models::{ForeignKey, SqlType};

fn guests_schema() -> TableSchema {
    let mut row_id = column("row_id", SqlType::Text);
    row_id.not_null = true;
    let mut guest = column("guest", SqlType::Text);
    guest.entity_type = Some(EntityType::User);
    let mut status = column("status", SqlType::Text);
    status.allowed_values = Some(vec![
        "Going".to_string(),
        "Not yet asked".to_string(),
        "Declined".to_string(),
    ]);
    let mut room = column("room", SqlType::Text);
    room.writable = false;
    TableSchema {
        sql_name: "guests".to_string(),
        source: TableSource::UserTable(Uuid::nil()),
        columns: vec![
            row_id,
            guest,
            status,
            column("plus_ones", SqlType::Real),
            room,
        ],
        primary_key: vec!["row_id".to_string()],
        foreign_keys: vec![],
        writable: true,
    }
}

fn junction_schema() -> TableSchema {
    let mut row_id = column("row_id", SqlType::Text);
    row_id.not_null = true;
    let mut linked = column("linked_id", SqlType::Text);
    linked.not_null = true;
    TableSchema {
        sql_name: "guests__sessions".to_string(),
        source: TableSource::Junction {
            table_id: Uuid::nil(),
            column_id: Uuid::nil(),
        },
        columns: vec![row_id, linked],
        primary_key: vec!["row_id".to_string(), "linked_id".to_string()],
        foreign_keys: vec![ForeignKey {
            column: "row_id".to_string(),
            references_table: "guests".to_string(),
            references_column: "row_id".to_string(),
        }],
        writable: true,
    }
}

fn people_schema() -> TableSchema {
    let mut id = column("id", SqlType::Text);
    id.entity_type = Some(EntityType::User);
    id.writable = false;
    let mut email = column("email", SqlType::Text);
    email.writable = false;
    TableSchema {
        sql_name: "people".to_string(),
        source: TableSource::Magic("people".to_string()),
        columns: vec![id, email],
        primary_key: vec!["id".to_string()],
        foreign_keys: vec![],
        writable: false,
    }
}

fn catalog() -> Catalog {
    Catalog {
        tables: vec![guests_schema(), junction_schema(), people_schema()],
    }
}

fn text(s: &str) -> SqlValue {
    SqlValue::Text(s.to_string())
}

fn guests_rows() -> MaterializedTable {
    MaterializedTable {
        schema: guests_schema(),
        rows: vec![
            vec![
                text("r1"),
                text("usr_sam"),
                text("Going"),
                SqlValue::Real(2.0),
                text("Main Hall"),
            ],
            vec![
                text("r2"),
                text("usr_tara"),
                text("Not yet asked"),
                SqlValue::Null,
                SqlValue::Null,
            ],
        ],
    }
}

fn people_rows() -> MaterializedTable {
    MaterializedTable {
        schema: people_schema(),
        rows: vec![
            vec![text("usr_sam"), text("sam@acme.co")],
            vec![text("usr_tara"), text("tara@partner.io")],
        ],
    }
}

fn executor() -> RusqliteExecutor {
    RusqliteExecutor::new(ExecutorLimits::default())
}

#[test]
fn ddl_compiles_constraints() {
    let ddl = RusqliteExecutor::compile_ddl(&guests_schema());
    assert!(ddl.contains("STRICT"), "{ddl}");
    assert!(
        ddl.contains("\"row_id\" TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))"),
        "{ddl}"
    );
    assert!(
        ddl.contains(
            "CHECK (\"status\" IS NULL OR \"status\" IN ('Going', 'Not yet asked', 'Declined'))"
        ),
        "{ddl}"
    );
    assert!(ddl.contains("PRIMARY KEY (\"row_id\")"), "{ddl}");
    let junction = RusqliteExecutor::compile_ddl(&junction_schema());
    assert!(
        junction.contains("FOREIGN KEY (\"row_id\") REFERENCES \"guests\"(\"row_id\")"),
        "{junction}"
    );
}

#[test]
fn analyze_reports_read_columns_and_writes() {
    let deps = executor()
        .analyze(
            &catalog(),
            "SELECT p.email FROM guests g JOIN people p ON p.id = g.guest WHERE g.status = 'Going'",
        )
        .expect("valid query");
    let guests = &deps.tables["guests"];
    assert!(!guests.written);
    assert!(guests.read_columns.contains(&"guest".to_string()));
    assert!(guests.read_columns.contains(&"status".to_string()));
    let people = &deps.tables["people"];
    assert!(people.read_columns.contains(&"email".to_string()));
    assert!(!deps.tables.contains_key("guests__sessions"));

    let deps = executor()
        .analyze(
            &catalog(),
            "UPDATE guests SET status = 'Going' WHERE row_id = 'r2'",
        )
        .expect("valid statement");
    assert!(deps.tables["guests"].written);
}

#[test]
fn analyze_rejects_unknown_table_verbatim() {
    let err = executor()
        .analyze(&catalog(), "SELECT * FROM nope")
        .expect_err("unknown table");
    match err {
        QueryError::Sql(msg) => assert!(msg.contains("no such table: nope"), "{msg}"),
        other => panic!("expected Sql, got {other:?}"),
    }
}

#[test]
fn analyze_denies_ddl() {
    let err = executor()
        .analyze(&catalog(), "DROP TABLE guests")
        .expect_err("ddl denied");
    assert!(matches!(err, QueryError::ReadOnly(_)), "{err:?}");
}

#[test]
fn execute_select_returns_typed_rows_with_provenance() {
    let (results, changes) = executor()
        .execute(
            &catalog(),
            vec![guests_rows(), people_rows()],
            "SELECT g.guest, p.email, g.plus_ones FROM guests g JOIN people p ON p.id = g.guest ORDER BY g.guest",
        )
        .expect("select runs");
    assert!(changes.is_empty());
    assert_eq!(results.len(), 1);
    let result = &results[0];
    assert_eq!(result.columns[0].name, "guest");
    assert_eq!(result.columns[0].entity_type, Some(EntityType::User));
    assert_eq!(
        result.columns[0].origin,
        Some(("guests".to_string(), "guest".to_string()))
    );
    assert_eq!(
        result.columns[1].origin,
        Some(("people".to_string(), "email".to_string()))
    );
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.rows[0][0], text("usr_sam"));
    assert_eq!(result.rows[0][1], text("sam@acme.co"));
    assert_eq!(result.rows[0][2], SqlValue::Real(2.0));
}

#[test]
fn execute_captures_insert_update_delete_changes() {
    let (results, changes) = executor()
        .execute(
            &catalog(),
            vec![guests_rows()],
            "INSERT INTO guests (guest, status) VALUES ('usr_new', 'Declined');
             UPDATE guests SET status = 'Going', plus_ones = 1 WHERE row_id = 'r2';
             DELETE FROM guests WHERE row_id = 'r1';
             SELECT count(*) AS n FROM guests",
        )
        .expect("writes run");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].rows[0][0], SqlValue::Integer(2));

    let insert = changes
        .iter()
        .find(|c| c.op == RawOp::Insert)
        .expect("insert");
    assert_eq!(insert.table, "guests");
    let (pk_col, pk_val) = &insert.primary_key[0];
    assert_eq!(pk_col, "row_id");
    assert!(
        matches!(pk_val, SqlValue::Text(id) if id.len() == 32),
        "defaulted id: {pk_val:?}"
    );
    assert!(
        insert
            .new_values
            .contains(&("guest".to_string(), text("usr_new")))
    );
    assert!(
        insert
            .new_values
            .contains(&("status".to_string(), text("Declined")))
    );

    let update = changes
        .iter()
        .find(|c| c.op == RawOp::Update)
        .expect("update");
    assert_eq!(update.primary_key, vec![("row_id".to_string(), text("r2"))]);
    assert_eq!(
        update.new_values.len(),
        2,
        "only changed columns: {:?}",
        update.new_values
    );
    assert!(
        update
            .new_values
            .contains(&("status".to_string(), text("Going")))
    );
    assert!(
        update
            .new_values
            .contains(&("plus_ones".to_string(), SqlValue::Real(1.0)))
    );

    let delete = changes
        .iter()
        .find(|c| c.op == RawOp::Delete)
        .expect("delete");
    assert_eq!(delete.primary_key, vec![("row_id".to_string(), text("r1"))]);
    assert!(delete.new_values.is_empty());
}

#[test]
fn execute_enforces_compiled_validity() {
    let err = executor()
        .execute(
            &catalog(),
            vec![guests_rows()],
            "UPDATE guests SET status = 'Maybe' WHERE row_id = 'r1'",
        )
        .expect_err("bad option");
    match err {
        QueryError::Sql(msg) => assert!(msg.contains("CHECK constraint failed"), "{msg}"),
        other => panic!("expected Sql, got {other:?}"),
    }

    let err = executor()
        .execute(
            &catalog(),
            vec![guests_rows()],
            "UPDATE guests SET plus_ones = 'lots' WHERE row_id = 'r1'",
        )
        .expect_err("strict typing");
    assert!(matches!(err, QueryError::Sql(_)), "{err:?}");

    let err = executor()
        .execute(
            &catalog(),
            vec![
                guests_rows(),
                MaterializedTable {
                    schema: junction_schema(),
                    rows: vec![],
                },
            ],
            "INSERT INTO guests__sessions (row_id, linked_id) VALUES ('ghost', 's1')",
        )
        .expect_err("fk");
    match err {
        QueryError::Sql(msg) => assert!(msg.contains("FOREIGN KEY constraint failed"), "{msg}"),
        other => panic!("expected Sql, got {other:?}"),
    }
}

#[test]
fn execute_rejects_writes_to_read_only_tables_and_columns() {
    let err = executor()
        .execute(
            &catalog(),
            vec![people_rows()],
            "UPDATE people SET email = 'x' WHERE id = 'usr_sam'",
        )
        .expect_err("magic tables are read-only");
    match err {
        QueryError::ReadOnly(reason) => assert!(reason.contains("read-only"), "{reason}"),
        other => panic!("expected ReadOnly, got {other:?}"),
    }

    let err = executor()
        .execute(
            &catalog(),
            vec![guests_rows()],
            "UPDATE guests SET room = 'Terrace' WHERE row_id = 'r1'",
        )
        .expect_err("derived column");
    match err {
        QueryError::ReadOnly(reason) => assert!(reason.contains("derived"), "{reason}"),
        other => panic!("expected ReadOnly, got {other:?}"),
    }
}

#[test]
fn execute_is_atomic_on_failure() {
    // The first statement would succeed; the second fails validation. No
    // changeset must escape.
    let err = executor()
        .execute(
            &catalog(),
            vec![guests_rows()],
            "DELETE FROM guests WHERE row_id = 'r1'; UPDATE guests SET status = 'Maybe'",
        )
        .expect_err("second statement fails");
    assert!(matches!(err, QueryError::Sql(_)));
}

#[test]
fn execute_enforces_time_budget() {
    let exec = RusqliteExecutor::new(ExecutorLimits {
        timeout: Duration::from_millis(20),
        ..ExecutorLimits::default()
    });
    let err = exec
        .execute(
            &catalog(),
            vec![],
            "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c",
        )
        .expect_err("infinite recursion is interrupted");
    assert!(matches!(err, QueryError::BudgetExceeded), "{err:?}");
}

#[test]
fn execute_enforces_row_cap() {
    let exec = RusqliteExecutor::new(ExecutorLimits {
        max_result_rows: 1,
        ..ExecutorLimits::default()
    });
    let err = exec
        .execute(&catalog(), vec![guests_rows()], "SELECT row_id FROM guests")
        .expect_err("two rows exceed the cap");
    assert!(matches!(err, QueryError::BudgetExceeded), "{err:?}");
}

#[test]
fn snapshot_is_a_sqlite_file() {
    let bytes = executor()
        .serialize_snapshot(vec![guests_rows(), people_rows()])
        .expect("serialize");
    assert!(bytes.starts_with(b"SQLite format 3\0"));

    // Round trip: the snapshot opens as a database file and still holds the data.
    let path = std::env::temp_dir().join(format!("databases-snapshot-{}.sqlite", Uuid::new_v4()));
    std::fs::write(&path, &bytes).unwrap();
    let conn = Connection::open(&path).unwrap();
    let n: i64 = conn
        .query_row("SELECT count(*) FROM guests", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 2);
    drop(conn);
    let _ = std::fs::remove_file(path);
}
