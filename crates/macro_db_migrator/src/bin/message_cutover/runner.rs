//! Database-only release tooling. No application request or authorization path.
//!
//! Runtime queries are intentional: legacy tables cease to exist after cutover,
//! so they cannot be checked against the current application schema by SQLx.

#![expect(
    clippy::disallowed_methods,
    reason = "Cutover queries span legacy and final schemas; SQLx cannot check the removed legacy tables against the current schema"
)]

use std::borrow::Cow;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::{Uuid, generate_uuid_v7};
use sqlx::{Connection, PgConnection, migrate::Migrator};

const PREPARE_VERSION: i64 = 20260904222458;
const CUTOVER_VERSION: i64 = 20260904223029;
const LOCK_ID: i64 = 732847201;
const BATCH_SIZE: i64 = 1_000;

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
pub(super) enum Phase {
    Prepare,
    Finish,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Outcome {
    Prepared,
    Finished,
    AlreadyCompleted,
}

/// The caller owns this dedicated connection; dropping it also releases the lock.
pub(super) async fn run(
    connection: &mut PgConnection,
    phase: Phase,
) -> Result<Outcome, rootcause::Report> {
    let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(LOCK_ID)
        .fetch_one(&mut *connection)
        .await?;
    if !acquired {
        rootcause::bail!("Another message cutover command is running");
    }
    let result = run_locked(connection, phase).await;
    let unlock = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(LOCK_ID)
        .execute(&mut *connection)
        .await;
    let outcome = result?;
    unlock?;
    Ok(outcome)
}

async fn run_locked(
    connection: &mut PgConnection,
    phase: Phase,
) -> Result<Outcome, rootcause::Report> {
    let ledger_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
            .fetch_one(&mut *connection)
            .await?;
    if ledger_exists {
        let completed: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM _sqlx_migrations WHERE version = $1 AND success)",
        )
        .bind(CUTOVER_VERSION)
        .fetch_one(&mut *connection)
        .await?;
        if completed {
            return Ok(Outcome::AlreadyCompleted);
        }
    }
    match phase {
        Phase::Prepare => {
            migrate_to(connection, PREPARE_VERSION).await?;
            allocate_mappings(connection).await?;
            Ok(Outcome::Prepared)
        }
        Phase::Finish => {
            let prepared: bool =
                sqlx::query_scalar("SELECT to_regclass('migrated_comment_thread_id') IS NOT NULL")
                    .fetch_one(&mut *connection)
                    .await?;
            if !prepared {
                rootcause::bail!("Run message_cutover prepare before finish");
            }
            allocate_mappings(connection).await?;
            migrate_to(connection, CUTOVER_VERSION).await?;
            Ok(Outcome::Finished)
        }
    }
}

async fn migrate_to(connection: &mut PgConnection, target: i64) -> Result<(), rootcause::Report> {
    let count = MACRO_DB_MIGRATIONS
        .iter()
        .take_while(|migration| migration.version <= target)
        .count();
    let migrator = Migrator {
        migrations: Cow::Borrowed(&MACRO_DB_MIGRATIONS.migrations[..count]),
        ..Migrator::DEFAULT
    };
    migrator.run_direct(connection).await?;
    Ok(())
}

async fn allocate_mappings(connection: &mut PgConnection) -> Result<(), rootcause::Report> {
    let mut tx = connection.begin().await?;
    sqlx::query("LOCK TABLE \"Comment\", \"Thread\" IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;
    let ambiguous: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
            SELECT t.id FROM "Thread" t
            LEFT JOIN "PdfPlaceableCommentAnchor" p ON p."threadId" = t.id
            LEFT JOIN "PdfHighlightAnchor" h ON h."threadId" = t.id
            GROUP BY t.id HAVING count(DISTINCT p.uuid) + count(DISTINCT h.uuid) > 1
        )"#,
    )
    .fetch_one(&mut *tx)
    .await?;
    if ambiguous {
        rootcause::bail!("Multiple PDF anchors on a legacy thread; resolve before cutover");
    }

    let mut cursor: Option<i64> = None;
    loop {
        let rows: Vec<(i64, String)> = sqlx::query_as(
            r#"SELECT c.id, t."documentId" FROM "Comment" c
            JOIN "Thread" t ON t.id = c."threadId"
            LEFT JOIN migrated_comment_id m ON m.comment_id = c.id
            WHERE m.comment_id IS NULL AND ($1::bigint IS NULL OR c.id > $1)
            ORDER BY c.id LIMIT $2"#,
        )
        .bind(cursor)
        .bind(BATCH_SIZE)
        .fetch_all(&mut *tx)
        .await?;
        let Some(last) = rows.last() else { break };
        cursor = Some(last.0);
        let ids: Vec<_> = rows.iter().map(|row| row.0).collect();
        let uuids: Vec<_> = rows.iter().map(|_| generate_uuid_v7()).collect();
        let documents: Vec<_> = rows.iter().map(|row| row.1.as_str()).collect();
        sqlx::query(
            "INSERT INTO migrated_comment_id (comment_id, message_id, document_id)
             SELECT * FROM UNNEST($1::bigint[], $2::uuid[], $3::text[])",
        )
        .bind(&ids)
        .bind(&uuids)
        .bind(&documents)
        .execute(&mut *tx)
        .await?;
    }

    cursor = None;
    loop {
        let rows: Vec<(i64, String, Option<Uuid>)> = sqlx::query_as(
            r#"SELECT t.id, t."documentId", first.message_id FROM "Thread" t
            LEFT JOIN migrated_comment_thread_id tm ON tm.thread_id = t.id
            LEFT JOIN LATERAL (
                SELECT m.message_id FROM "Comment" c
                JOIN migrated_comment_id m ON m.comment_id = c.id
                WHERE c."threadId" = t.id
                ORDER BY c."order" NULLS LAST, c."createdAt", c.id LIMIT 1
            ) first ON true
            WHERE tm.thread_id IS NULL AND ($1::bigint IS NULL OR t.id > $1)
            ORDER BY t.id LIMIT $2"#,
        )
        .bind(cursor)
        .bind(BATCH_SIZE)
        .fetch_all(&mut *tx)
        .await?;
        let Some(last) = rows.last() else { break };
        cursor = Some(last.0);
        let ids: Vec<_> = rows.iter().map(|row| row.0).collect();
        let roots: Vec<_> = rows
            .iter()
            .map(|row| row.2.unwrap_or_else(generate_uuid_v7))
            .collect();
        let documents: Vec<_> = rows.iter().map(|row| row.1.as_str()).collect();
        sqlx::query(
            "INSERT INTO migrated_comment_thread_id (thread_id, root_id, document_id)
             SELECT * FROM UNNEST($1::bigint[], $2::uuid[], $3::text[])",
        )
        .bind(&ids)
        .bind(&roots)
        .bind(&documents)
        .execute(&mut *tx)
        .await?;
    }

    let changed: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
            SELECT 1 FROM "Thread" t
            JOIN migrated_comment_thread_id m ON m.thread_id = t.id
            LEFT JOIN LATERAL (
                SELECT cm.message_id FROM "Comment" c
                JOIN migrated_comment_id cm ON cm.comment_id = c.id
                WHERE c."threadId" = t.id
                ORDER BY c."order" NULLS LAST, c."createdAt", c.id LIMIT 1
            ) first ON true
            WHERE m.document_id <> t."documentId"
                OR (first.message_id IS NOT NULL AND m.root_id <> first.message_id)
        ) OR EXISTS (
            SELECT 1 FROM "Comment" c JOIN "Thread" t ON t.id = c."threadId"
            JOIN migrated_comment_id m ON m.comment_id = c.id
            WHERE m.document_id <> t."documentId"
        )"#,
    )
    .fetch_one(&mut *tx)
    .await?;
    if changed {
        rootcause::bail!("Legacy data changed after UUID allocation; keep writers paused");
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
#[path = "test.rs"]
mod test;
