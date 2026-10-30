use crate::{audit, backfill};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgConnection, PgPool};

mod concurrency;
mod fuzz;

const DOC: &str = "10000000-0000-4000-8000-000000000001";
const DOC_2: &str = "10000000-0000-4000-8000-000000000002";
const CHAT: &str = "20000000-0000-4000-8000-000000000001";
const PROJECT: &str = "30000000-0000-4000-8000-000000000001";
const CHILD_PROJECT: &str = "30000000-0000-4000-8000-000000000002";
const OWNER: &str = "macro|owner@example.com";
const MEMBER: &str = "macro|member@example.com";
const TEAM: &str = "40000000-0000-4000-8000-000000000001";
const CHANNEL: &str = "50000000-0000-4000-8000-000000000001";

/// One `source_items` row, with `sort_ts` as text so tests compare it to the item's own
/// timestamps in SQL.
#[derive(Debug, PartialEq, Eq)]
struct Row {
    source_id: String,
    kind: String,
    sort_ts: Option<String>,
    grants: i32,
}

fn row(source_id: &str, kind: &str, sort_ts: Option<&str>, grants: i32) -> Row {
    Row {
        source_id: source_id.to_owned(),
        kind: kind.to_owned(),
        sort_ts: sort_ts.map(str::to_owned),
        grants,
    }
}

async fn rows(conn: &mut PgConnection, entity_id: &str) -> Result<Vec<Row>, sqlx::Error> {
    sqlx::query_as!(
        Row,
        r#"SELECT source_id, kind, sort_ts::text AS sort_ts, grants
           FROM source_items WHERE entity_id = $1 ORDER BY source_id"#,
        entity_id,
    )
    .fetch_all(conn)
    .await
}

async fn assert_exact(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mismatches = audit::run(pool).await?;
    assert!(mismatches.is_empty(), "source_items drifted: {mismatches:?}");
    Ok(())
}

async fn insert_document(conn: &mut PgConnection, id: &str, at: &str) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
           VALUES ($1, 'Document', $2, $3::text::timestamp, $3::text::timestamp)"#,
        id,
        OWNER,
        at,
    )
    .execute(conn)
    .await?;
    Ok(())
}

async fn grant(
    conn: &mut PgConnection,
    entity_type: &str,
    entity_id: &str,
    source_id: &str,
    source_type: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1::text::uuid, $2, $3, $4::text::entity_access_source_type, 'view')"#,
        entity_id,
        entity_type,
        source_id,
        source_type,
    )
    .execute(conn)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grants_items_and_subtypes_drive_rows(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;
    assert_eq!(rows(&mut conn, DOC).await?, []);

    grant(&mut conn, "document", DOC, OWNER, "user").await?;
    grant(&mut conn, "document", DOC, TEAM, "team").await?;
    grant(&mut conn, "document", DOC, CHANNEL, "channel").await?;
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Project', $2)"#,
        PROJECT,
        OWNER,
    )
    .execute(&mut *conn)
    .await?;
    // A second grant from the same source, inherited through a project, shares the row.
    sqlx::query!(
        r#"INSERT INTO entity_access
               (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
           VALUES ($1::text::uuid, 'document', $2, 'team', 'view', $3)"#,
        DOC,
        TEAM,
        PROJECT,
    )
    .execute(&mut *conn)
    .await?;
    let at = Some("2026-01-01 00:00:00");
    assert_eq!(
        rows(&mut conn, DOC).await?,
        [
            row(TEAM, "document", at, 2),
            row(CHANNEL, "document", at, 1),
            row(OWNER, "document", at, 1),
        ]
    );
    assert_exact(&pool).await?;

    sqlx::query!(
        r#"UPDATE "Document" SET "updatedAt" = '2026-02-01 00:00:00' WHERE id = $1"#,
        DOC
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
        DOC
    )
    .execute(&mut *conn)
    .await?;
    let at = Some("2026-02-01 00:00:00");
    assert_eq!(
        rows(&mut conn, DOC).await?,
        [
            row(TEAM, "task", at, 2),
            row(CHANNEL, "task", at, 1),
            row(OWNER, "task", at, 1),
        ]
    );

    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = '2026-02-02 00:00:00' WHERE id = $1"#,
        DOC
    )
    .execute(&mut *conn)
    .await?;
    assert!(
        rows(&mut conn, DOC)
            .await?
            .iter()
            .all(|row| row.sort_ts.is_none())
    );
    assert_exact(&pool).await?;

    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NULL WHERE id = $1"#,
        DOC
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!("DELETE FROM document_sub_type WHERE document_id = $1", DOC)
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1::text::uuid AND granted_from_project_id IS NOT NULL",
        DOC
    )
    .execute(&mut *conn)
    .await?;
    assert_eq!(
        rows(&mut conn, DOC).await?,
        [
            row(TEAM, "document", at, 1),
            row(CHANNEL, "document", at, 1),
            row(OWNER, "document", at, 1),
        ]
    );

    sqlx::query!(
        r#"INSERT INTO "Chat" (id, "userId", name, "updatedAt") VALUES ($1, $2, 'Chat', '2026-03-01')"#,
        CHAT,
        OWNER,
    )
    .execute(&mut *conn)
    .await?;
    grant(&mut conn, "chat", CHAT, OWNER, "user").await?;
    grant(&mut conn, "project", PROJECT, MEMBER, "user").await?;
    assert_eq!(
        rows(&mut conn, CHAT).await?,
        [row(OWNER, "chat", Some("2026-03-01 00:00:00"), 1)]
    );
    assert_eq!(rows(&mut conn, PROJECT).await?.len(), 1);
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grants_written_before_their_item_count_once(pool: PgPool) -> Result<(), sqlx::Error> {
    // Replica mode skips foreign keys, so fixtures load grants and subtypes before items.
    let mut tx = pool.begin().await?;
    sqlx::query!("SET LOCAL session_replication_role = replica")
        .execute(&mut *tx)
        .await?;
    grant(&mut tx, "document", DOC, OWNER, "user").await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
        DOC
    )
    .execute(&mut *tx)
    .await?;
    insert_document(&mut tx, DOC, "2026-01-01 00:00:00").await?;
    tx.commit().await?;
    let mut conn = pool.acquire().await?;
    assert_eq!(
        rows(&mut conn, DOC).await?,
        [row(OWNER, "task", Some("2026-01-01 00:00:00"), 1)]
    );

    // One statement that inserts an item and its grant fires both triggers after the statement.
    sqlx::query!(
        r#"WITH d AS (
               INSERT INTO "Document" (id, name, owner, "updatedAt")
               VALUES ($1, 'Document', $2, '2026-01-02')
               RETURNING id
           )
           INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           SELECT id::uuid, 'document', $2, 'user', 'owner' FROM d"#,
        DOC_2,
        OWNER,
    )
    .execute(&mut *conn)
    .await?;
    assert_eq!(
        rows(&mut conn, DOC_2).await?,
        [row(OWNER, "document", Some("2026-01-02 00:00:00"), 1)]
    );
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grant_updates_move_rows(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;
    insert_document(&mut conn, DOC_2, "2026-01-02 00:00:00").await?;
    grant(&mut conn, "document", DOC, OWNER, "user").await?;

    sqlx::query!("UPDATE entity_access SET access_level = 'edit'")
        .execute(&mut *conn)
        .await?;
    sqlx::query!("UPDATE entity_access SET source_id = $1", MEMBER)
        .execute(&mut *conn)
        .await?;
    assert_eq!(
        rows(&mut conn, DOC).await?,
        [row(MEMBER, "document", Some("2026-01-01 00:00:00"), 1)]
    );
    sqlx::query!("UPDATE entity_access SET entity_id = $1::text::uuid", DOC_2)
        .execute(&mut *conn)
        .await?;
    assert_eq!(rows(&mut conn, DOC).await?, []);
    assert_eq!(
        rows(&mut conn, DOC_2).await?,
        [row(MEMBER, "document", Some("2026-01-02 00:00:00"), 1)]
    );
    // A statement that also rewrites the grant's id is still a move.
    sqlx::query!(
        "UPDATE entity_access SET id = id + 1000, source_id = $1, entity_id = $2::text::uuid",
        OWNER,
        DOC,
    )
    .execute(&mut *conn)
    .await?;
    assert_eq!(rows(&mut conn, DOC_2).await?, []);
    assert_eq!(
        rows(&mut conn, DOC).await?,
        [row(OWNER, "document", Some("2026-01-01 00:00:00"), 1)]
    );
    sqlx::query!("UPDATE entity_access SET id = id + 1000, entity_type = 'chat'")
        .execute(&mut *conn)
        .await?;
    assert_eq!(rows(&mut conn, DOC).await?, []);
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deletes_and_cascades_remove_rows(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Parent', $3), ($2, 'Child', $3)"#,
        PROJECT,
        CHILD_PROJECT,
        OWNER,
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"UPDATE "Project" SET "parentId" = $1 WHERE id = $2"#,
        PROJECT,
        CHILD_PROJECT
    )
    .execute(&mut *conn)
    .await?;
    insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;
    sqlx::query!(
        r#"UPDATE "Document" SET "projectId" = $1 WHERE id = $2"#,
        CHILD_PROJECT,
        DOC
    )
    .execute(&mut *conn)
    .await?;
    grant(&mut conn, "document", DOC, OWNER, "user").await?;
    grant(&mut conn, "project", CHILD_PROJECT, OWNER, "user").await?;
    grant(&mut conn, "project", CHILD_PROJECT, MEMBER, "user").await?;
    sqlx::query!(
        r#"INSERT INTO entity_access
               (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
           VALUES ($1::text::uuid, 'document', $2, 'user', 'view', $3)"#,
        DOC,
        MEMBER,
        CHILD_PROJECT,
    )
    .execute(&mut *conn)
    .await?;
    assert_eq!(rows(&mut conn, DOC).await?.len(), 2);

    // Deleting the parent cascades to the child project, the child's inherited grants and the
    // document's folder, with no application code running.
    sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, PROJECT)
        .execute(&mut *conn)
        .await?;
    assert_eq!(
        rows(&mut conn, DOC).await?,
        [row(OWNER, "document", Some("2026-01-01 00:00:00"), 1)]
    );
    assert_eq!(rows(&mut conn, CHILD_PROJECT).await?, []);
    assert_exact(&pool).await?;

    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, DOC)
        .execute(&mut *conn)
        .await?;
    assert_eq!(rows(&mut conn, DOC).await?, []);
    // The grants outlive the item until something deletes them.
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1::text::uuid",
        DOC
    )
    .execute(&mut *conn)
    .await?;
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn id_changes_move_rows(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
        DOC
    )
    .execute(&mut *conn)
    .await?;
    grant(&mut conn, "document", DOC, OWNER, "user").await?;
    grant(&mut conn, "document", DOC_2, MEMBER, "user").await?;

    // entity_access does not follow the id, so the new id gets the new id's grants. The subtype
    // follows through its ON UPDATE CASCADE.
    sqlx::query!(r#"UPDATE "Document" SET id = $1 WHERE id = $2"#, DOC_2, DOC)
        .execute(&mut *conn)
        .await?;
    assert_eq!(rows(&mut conn, DOC).await?, []);
    assert_eq!(
        rows(&mut conn, DOC_2).await?,
        [row(MEMBER, "task", Some("2026-01-01 00:00:00"), 1)]
    );
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn truncates_clear_rows(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
        DOC
    )
    .execute(&mut *conn)
    .await?;
    grant(&mut conn, "document", DOC, OWNER, "user").await?;
    sqlx::query!(
        r#"INSERT INTO "Chat" (id, "userId", name) VALUES ($1, $2, 'Chat')"#,
        CHAT,
        OWNER
    )
    .execute(&mut *conn)
    .await?;
    grant(&mut conn, "chat", CHAT, OWNER, "user").await?;

    sqlx::query!("TRUNCATE document_sub_type")
        .execute(&mut *conn)
        .await?;
    assert_eq!(rows(&mut conn, DOC).await?[0].kind, "document");
    assert_exact(&pool).await?;
    sqlx::query!(r#"TRUNCATE "Chat" CASCADE"#)
        .execute(&mut *conn)
        .await?;
    assert_eq!(rows(&mut conn, CHAT).await?, []);
    assert_exact(&pool).await?;
    sqlx::query!("TRUNCATE entity_access")
        .execute(&mut *conn)
        .await?;
    assert_eq!(rows(&mut conn, DOC).await?, []);
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn truncates_in_replica_mode_clear_rows(pool: PgPool) -> Result<(), sqlx::Error> {
    for truncate in [
        "TRUNCATE entity_access",
        "TRUNCATE document_sub_type",
        r#"TRUNCATE "Document" CASCADE"#,
        r#"TRUNCATE "Chat" CASCADE"#,
        r#"TRUNCATE "Project" CASCADE"#,
    ] {
        let mut conn = pool.acquire().await?;
        sqlx::query!(r#"TRUNCATE "Document", "Chat", "Project", entity_access CASCADE"#)
            .execute(&mut *conn)
            .await?;
        insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;
        sqlx::query!(
            "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
            DOC
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query!(
            r#"INSERT INTO "Chat" (id, "userId", name) VALUES ($1, $2, 'Chat')"#,
            CHAT,
            OWNER
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query!(
            r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Project', $2)"#,
            PROJECT,
            OWNER
        )
        .execute(&mut *conn)
        .await?;
        grant(&mut conn, "document", DOC, OWNER, "user").await?;
        grant(&mut conn, "chat", CHAT, OWNER, "user").await?;
        grant(&mut conn, "project", PROJECT, OWNER, "user").await?;

        let mut tx = pool.begin().await?;
        sqlx::query!("SET LOCAL session_replication_role = replica")
            .execute(&mut *tx)
            .await?;
        sqlx::query(truncate).execute(&mut *tx).await?;
        tx.commit().await?;
        let mismatches = audit::run(&pool).await?;
        assert!(mismatches.is_empty(), "{truncate}: {mismatches:?}");
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rollback_and_other_isolation_levels_change_nothing(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;

    // Rows change at commit, so a rolled-back write leaves nothing behind.
    let mut tx = pool.begin().await?;
    grant(&mut tx, "document", DOC, OWNER, "user").await?;
    assert_eq!(rows(&mut tx, DOC).await?, []);
    tx.rollback().await?;
    assert_eq!(rows(&mut conn, DOC).await?, []);

    grant(&mut conn, "document", DOC, OWNER, "user").await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
        DOC
    )
    .execute(&mut *conn)
    .await?;
    // A snapshot older than the previous lock holder's commit could miss its rows, so every write
    // to an input refuses other isolation levels.
    let writes = [
        format!(
            "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
             VALUES ('{DOC}', 'document', '{MEMBER}', 'user', 'view')"
        ),
        format!("UPDATE entity_access SET source_id = '{MEMBER}'"),
        "DELETE FROM entity_access".to_owned(),
        "TRUNCATE entity_access".to_owned(),
        format!(r#"INSERT INTO "Document" (id, name, owner) VALUES ('{DOC_2}', 'Document', '{OWNER}')"#),
        r#"UPDATE "Document" SET "updatedAt" = now()"#.to_owned(),
        r#"DELETE FROM "Document""#.to_owned(),
        r#"TRUNCATE "Document" CASCADE"#.to_owned(),
        "UPDATE document_sub_type SET sub_type = 'snippet'".to_owned(),
        "DELETE FROM document_sub_type".to_owned(),
        "TRUNCATE document_sub_type".to_owned(),
    ];
    for isolation in ["REPEATABLE READ", "SERIALIZABLE"] {
        for write in &writes {
            let mut tx = pool.begin().await?;
            sqlx::query(&format!("SET TRANSACTION ISOLATION LEVEL {isolation}"))
                .execute(&mut *tx)
                .await?;
            let error = sqlx::query(write).execute(&mut *tx).await.unwrap_err();
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()).as_deref(),
                Some("25000"),
                "{isolation} {write}: {error}"
            );
        }
    }
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_grant_change_rewrites_only_its_sources_rows(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    insert_document(&mut conn, DOC, "2026-01-01 00:00:00").await?;
    grant(&mut conn, "document", DOC, OWNER, "user").await?;
    grant(&mut conn, "document", DOC, TEAM, "team").await?;

    let mut tx = pool.begin().await?;
    let xid = sqlx::query_scalar!(
        r#"SELECT (pg_current_xact_id()::text::bigint % 4294967296)::text AS "xid!""#
    )
    .fetch_one(&mut *tx)
    .await?;
    grant(&mut tx, "document", DOC, MEMBER, "user").await?;
    sqlx::query!("DELETE FROM entity_access WHERE source_id = $1", TEAM)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    // The owner's row was neither rewritten nor locked by that transaction.
    let touched = sqlx::query_scalar!(
        r#"SELECT coalesce(array_agg(source_id ORDER BY source_id), '{}') AS "sources!"
           FROM source_items
           WHERE entity_id = $1 AND (xmin::text = $2 OR xmax::text = $2)"#,
        DOC,
        xid,
    )
    .fetch_one(&mut *conn)
    .await?;
    assert_eq!(touched, [MEMBER]);
    assert_exact(&pool).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn backfill_repairs_drift_across_batches_and_reruns(pool: PgPool) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner)
           SELECT '10000000-0000-4000-8000-' || lpad(n::text, 12, '0'), 'Document', $1
           FROM generate_series(1, 1200) n"#,
        OWNER,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           SELECT id::uuid, 'document', $1, 'user', 'owner' FROM "Document""#,
        OWNER,
    )
    .execute(&pool)
    .await?;
    assert_exact(&pool).await?;

    // Rows written before the triggers existed, or by hand, are drift only the backfill repairs:
    // a missing row, a wrong row, and a row for an item that no longer exists.
    sqlx::query!(
        r#"DELETE FROM source_items WHERE entity_id = '10000000-0000-4000-8000-000000000007'"#
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"UPDATE source_items SET grants = 3, kind = 'task'
           WHERE entity_id = '10000000-0000-4000-8000-000000000600'"#
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO source_items (source_id, entity_type, kind, entity_id, sort_ts, grants)
           VALUES ($1, 'document', 'document', 'ffffffff-0000-4000-8000-000000000000', NULL, 1)"#,
        OWNER,
    )
    .execute(&pool)
    .await?;
    let drift = audit::run(&pool).await?;
    assert_eq!(drift.missing_or_wrong, 2);
    assert_eq!(drift.extra_or_wrong, 2);

    assert_eq!(backfill::run(&pool).await?, 1201);
    assert_exact(&pool).await?;
    assert_eq!(backfill::run(&pool).await?, 1200);
    assert_exact(&pool).await
}
