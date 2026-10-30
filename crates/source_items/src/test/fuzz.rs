//! Random concurrent writes to every input of `source_items`, with audits of committed snapshots
//! running alongside. The triggers must leave every snapshot exact, whatever commits, rolls back
//! or deadlocks.

use super::assert_exact;
use crate::audit;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use rand::{Rng, SeedableRng, rngs::StdRng};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};
use std::collections::BTreeMap;
use tokio::sync::watch;

const WORKERS: u64 = 12;
const TRANSACTIONS_PER_WORKER: usize = 200;
/// A small id space, so transactions collide on the same items constantly. Some ids are only
/// ever granted, never inserted.
const DOCUMENTS: usize = 14;
const CHATS: usize = 5;
const PROJECTS: usize = 5;
const SOURCES: [(&str, &str); 5] = [
    ("macro|a@example.com", "user"),
    ("macro|b@example.com", "user"),
    ("40000000-0000-4000-8000-000000000001", "team"),
    ("40000000-0000-4000-8000-000000000002", "team"),
    ("50000000-0000-4000-8000-000000000001", "channel"),
];
/// Few distinct timestamps, so rows tie on `sort_ts`.
const TIMES: [&str; 4] = [
    "2026-01-01 00:00:00",
    "2026-01-02 00:00:00",
    "2026-01-02 00:00:00.5",
    "2026-01-03 00:00:00",
];
/// Errors the random workload causes by itself. Anything else, such as an error raised by a
/// trigger, fails the test.
const EXPECTED_ERRORS: [&str; 4] = [
    "23503", // foreign key violation
    "23505", // unique violation
    "40P01", // deadlock detected
    "55P03", // lock timeout
];

fn document(n: usize) -> String {
    format!("10000000-0000-4000-8000-{n:012}")
}

fn chat(n: usize) -> String {
    format!("20000000-0000-4000-8000-{n:012}")
}

fn project(n: usize) -> String {
    format!("30000000-0000-4000-8000-{n:012}")
}

fn item(rng: &mut StdRng) -> (&'static str, String) {
    match rng.random_range(0..4) {
        0 | 1 => ("document", document(rng.random_range(0..DOCUMENTS))),
        2 => ("chat", chat(rng.random_range(0..CHATS))),
        _ => ("project", project(rng.random_range(0..PROJECTS))),
    }
}

fn table(entity_type: &str) -> &'static str {
    match entity_type {
        "document" => r#""Document""#,
        "chat" => r#""Chat""#,
        _ => r#""Project""#,
    }
}

/// One random write. The statements are built at run time, so they use unchecked queries.
async fn write(conn: &mut PgConnection, rng: &mut StdRng) -> Result<&'static str, sqlx::Error> {
    let at = TIMES[rng.random_range(0..TIMES.len())];
    let (source, source_type) = SOURCES[rng.random_range(0..SOURCES.len())];
    let (entity_type, id) = item(rng);
    let op = match rng.random_range(0..17) {
        0 | 1 => {
            let sql = match entity_type {
                "document" => {
                    r#"INSERT INTO "Document" (id, name, owner, "updatedAt") VALUES ($1, 'd', 'o', $2::text::timestamp) ON CONFLICT DO NOTHING"#
                }
                "chat" => {
                    r#"INSERT INTO "Chat" (id, name, "userId", "updatedAt") VALUES ($1, 'c', 'o', $2::text::timestamp) ON CONFLICT DO NOTHING"#
                }
                _ => {
                    r#"INSERT INTO "Project" (id, name, "userId", "updatedAt") VALUES ($1, 'p', 'o', $2::text::timestamp) ON CONFLICT DO NOTHING"#
                }
            };
            sqlx::query(sql).bind(&id).bind(at).execute(conn).await?;
            "insert item"
        }
        2 | 3 => {
            let sql = format!(
                r#"UPDATE {} SET "updatedAt" = $2::text::timestamp WHERE id = $1"#,
                table(entity_type)
            );
            sqlx::query(&sql).bind(&id).bind(at).execute(conn).await?;
            "save item"
        }
        4 => {
            let deleted = if rng.random_bool(0.5) { "NULL" } else { "now()" };
            let sql = format!(
                r#"UPDATE {} SET "deletedAt" = {deleted} WHERE id = $1"#,
                table(entity_type)
            );
            sqlx::query(&sql).bind(&id).execute(conn).await?;
            "soft delete or restore"
        }
        5 => {
            let sql = format!("DELETE FROM {} WHERE id = $1", table(entity_type));
            sqlx::query(&sql).bind(&id).execute(conn).await?;
            "hard delete item"
        }
        6..=8 => {
            let inherited = rng
                .random_bool(0.3)
                .then(|| project(rng.random_range(0..PROJECTS)));
            sqlx::query(
                "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
                 VALUES ($1::text::uuid, $2, $3, $4::text::entity_access_source_type, 'view', $5)
                 ON CONFLICT DO NOTHING",
            )
            .bind(&id)
            .bind(entity_type)
            .bind(source)
            .bind(source_type)
            .bind(inherited)
            .execute(conn)
            .await?;
            "grant"
        }
        9 => {
            // Shares every item of a type at once, like a team share.
            let sql = format!(
                "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
                 SELECT id::uuid, $1, $2, $3::text::entity_access_source_type, 'view' FROM {}
                 ON CONFLICT DO NOTHING",
                table(entity_type)
            );
            sqlx::query(&sql)
                .bind(entity_type)
                .bind(source)
                .bind(source_type)
                .execute(conn)
                .await?;
            "bulk grant"
        }
        10 => {
            sqlx::query("DELETE FROM entity_access WHERE entity_id = $1::text::uuid AND source_id = $2")
                .bind(&id)
                .bind(source)
                .execute(conn)
                .await?;
            "revoke"
        }
        11 => {
            sqlx::query("DELETE FROM entity_access WHERE source_id = $1")
                .bind(source)
                .execute(conn)
                .await?;
            "revoke a source"
        }
        12 => {
            let (other_type, other) = item(rng);
            // Sometimes the grant's id changes in the same statement.
            let id_shift: i64 = if rng.random_bool(0.3) { 1_000_000 } else { 0 };
            sqlx::query(
                "UPDATE entity_access SET id = id + $4, entity_id = $1::text::uuid, entity_type = $2, source_id = $3
                 WHERE id = (SELECT id FROM entity_access ORDER BY random() LIMIT 1)",
            )
            .bind(&other)
            .bind(other_type)
            .bind(source)
            .bind(id_shift)
            .execute(conn)
            .await?;
            "move a grant"
        }
        13 => {
            let doc = document(rng.random_range(0..DOCUMENTS));
            let sub_type = if rng.random_bool(0.7) { "task" } else { "skill" };
            sqlx::query(
                "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, $2::text::document_sub_type_value)
                 ON CONFLICT (document_id) DO UPDATE SET sub_type = EXCLUDED.sub_type",
            )
            .bind(&doc)
            .bind(sub_type)
            .execute(conn)
            .await?;
            "set subtype"
        }
        14 => {
            let doc = document(rng.random_range(0..DOCUMENTS));
            sqlx::query("DELETE FROM document_sub_type WHERE document_id = $1")
                .bind(&doc)
                .execute(conn)
                .await?;
            "clear subtype"
        }
        15 => {
            let from = document(rng.random_range(0..DOCUMENTS));
            let to = document(rng.random_range(0..DOCUMENTS));
            sqlx::query(r#"UPDATE "Document" SET id = $2 WHERE id = $1"#)
                .bind(&from)
                .bind(&to)
                .execute(conn)
                .await?;
            "change a document id"
        }
        _ => {
            // Cascades to child projects and their inherited grants, and clears folders.
            let parent = project(rng.random_range(0..PROJECTS));
            let child = project(rng.random_range(0..PROJECTS));
            if rng.random_bool(0.5) {
                sqlx::query(r#"UPDATE "Project" SET "parentId" = $1 WHERE id = $2 AND id <> $1"#)
                    .bind(&parent)
                    .bind(&child)
                    .execute(conn)
                    .await?;
                "nest a project"
            } else {
                sqlx::query(r#"DELETE FROM "Project" WHERE id = $1"#)
                    .bind(&parent)
                    .execute(conn)
                    .await?;
                "delete a project tree"
            }
        }
    };
    Ok(op)
}

#[derive(Debug, Default)]
struct Tally {
    committed: usize,
    rolled_back: usize,
    errors: BTreeMap<String, usize>,
    ops: BTreeMap<&'static str, usize>,
}

fn expected(error: &sqlx::Error) -> Option<String> {
    let code = error.as_database_error()?.code()?.into_owned();
    EXPECTED_ERRORS.contains(&code.as_str()).then_some(code)
}

async fn transaction(
    tx: &mut Transaction<'_, Postgres>,
    rng: &mut StdRng,
    key_limit: Option<i32>,
    tally: &mut Tally,
) -> Result<(), sqlx::Error> {
    sqlx::query("SET LOCAL lock_timeout = '5s'")
        .execute(&mut **tx)
        .await?;
    if rng.random_bool(0.2) {
        // Foreign keys off: grants, subtypes and folders can name items that do not exist yet.
        sqlx::query("SET LOCAL session_replication_role = replica")
            .execute(&mut **tx)
            .await?;
    }
    let limit = key_limit.unwrap_or_else(|| {
        if rng.random_bool(0.3) {
            rng.random_range(0..3)
        } else {
            4096
        }
    });
    sqlx::query("SELECT set_config('source_items.key_limit', $1, true)")
        .bind(limit.to_string())
        .execute(&mut **tx)
        .await?;
    for _ in 0..rng.random_range(1..=4) {
        if rng.random_bool(0.15) {
            // A write undone by a savepoint takes its trigger work with it.
            sqlx::query("SAVEPOINT undone").execute(&mut **tx).await?;
            let op = write(tx, rng).await?;
            sqlx::query("ROLLBACK TO SAVEPOINT undone")
                .execute(&mut **tx)
                .await?;
            *tally.ops.entry(op).or_default() += 1;
        } else {
            let op = write(tx, rng).await?;
            *tally.ops.entry(op).or_default() += 1;
        }
    }
    Ok(())
}

async fn worker(pool: PgPool, seed: u64, key_limit: Option<i32>) -> Result<Tally, sqlx::Error> {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut tally = Tally::default();
    for _ in 0..TRANSACTIONS_PER_WORKER {
        let mut tx = pool.begin().await?;
        match transaction(&mut tx, &mut rng, key_limit, &mut tally).await {
            Ok(()) if rng.random_bool(0.85) => match tx.commit().await {
                Ok(()) => tally.committed += 1,
                Err(error) => {
                    let code = expected(&error)
                        .unwrap_or_else(|| panic!("commit failed unexpectedly: {error}"));
                    *tally.errors.entry(code).or_default() += 1;
                }
            },
            Ok(()) => {
                tx.rollback().await?;
                tally.rolled_back += 1;
            }
            Err(error) => {
                let code =
                    expected(&error).unwrap_or_else(|| panic!("write failed unexpectedly: {error}"));
                *tally.errors.entry(code).or_default() += 1;
                tx.rollback().await?;
            }
        }
    }
    Ok(tally)
}

async fn run(pool: PgPool, key_limit: Option<i32>) -> Result<(), sqlx::Error> {
    let (stop, stopped) = watch::channel(false);
    let auditor = {
        let pool = pool.clone();
        let mut stopped = stopped.clone();
        tokio::spawn(async move {
            let mut audits = 0;
            loop {
                tokio::select! {
                    _ = stopped.changed() => return Ok::<_, sqlx::Error>(audits),
                    mismatches = audit::run(&pool) => {
                        let mismatches = mismatches?;
                        assert!(mismatches.is_empty(), "a committed snapshot drifted: {mismatches:?}");
                        audits += 1;
                    }
                }
            }
        })
    };
    let workers = (0..WORKERS)
        .map(|seed| tokio::spawn(worker(pool.clone(), seed, key_limit)))
        .collect::<Vec<_>>();
    let mut total = Tally::default();
    for handle in workers {
        let tally = handle.await.expect("worker panicked")?;
        total.committed += tally.committed;
        total.rolled_back += tally.rolled_back;
        for (code, n) in tally.errors {
            *total.errors.entry(code).or_default() += n;
        }
        for (op, n) in tally.ops {
            *total.ops.entry(op).or_default() += n;
        }
    }
    let _ = stop.send(true);
    let audits = auditor.await.expect("auditor panicked")?;
    println!("{total:#?}\nconcurrent audits: {audits}");
    assert!(
        total.committed > (WORKERS as usize * TRANSACTIONS_PER_WORKER) / 3,
        "too few commits to mean anything: {total:?}"
    );
    assert!(audits > 0);
    let projected = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM source_items"#)
        .fetch_one(&pool)
        .await?;
    assert!(projected > 0, "the workload left nothing to compare");
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn random_concurrent_writes_keep_every_snapshot_exact(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    run(pool, None).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn random_concurrent_writes_through_bucket_and_global_keys(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    run(pool, Some(0)).await
}
