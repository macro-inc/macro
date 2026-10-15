use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::{sync::Arc, time::Duration};

const DOC: &str = "10000000-0000-4000-8000-000000000001";

async fn seed(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, 'Document', 'owner')"#,
        DOC,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1::text::uuid, 'document', 'owner', 'user', 'owner')"#,
        DOC,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn count(pool: &PgPool) -> Result<i64, sqlx::Error> {
    Ok(sqlx::query_scalar!("SELECT count(*) FROM source_items")
        .fetch_one(pool)
        .await?
        .unwrap())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn migration_installs_no_maintenance_triggers(pool: PgPool) -> Result<(), sqlx::Error> {
    let triggers =
        sqlx::query_scalar!("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'source_items%'",)
            .fetch_one(&pool)
            .await?;
    assert_eq!(triggers, Some(0));
    seed(&pool).await?;
    assert_eq!(count(&pool).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn refresh_tracks_subtype_lifecycle_and_rolls_back_atomically(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    seed(&pool).await?;
    let mut tx = pool.begin().await?;
    sync_one(&mut tx, EntityType::Document, DOC).await?;
    tx.commit().await?;
    assert_eq!(count(&pool).await?, 1);

    let mut tx = pool.begin().await?;
    sqlx::query!(
        "INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')",
        DOC
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
        DOC
    )
    .execute(&mut *tx)
    .await?;
    sync_one(&mut tx, EntityType::Document, DOC).await?;
    let row = sqlx::query!(
        "SELECT kind, sort_ts FROM source_items WHERE entity_id = $1",
        DOC
    )
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(row.kind, "task");
    assert!(row.sort_ts.is_none());
    tx.rollback().await?;
    let row = sqlx::query!(
        "SELECT kind, sort_ts FROM source_items WHERE entity_id = $1",
        DOC
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.kind, "document");
    assert!(row.sort_ts.is_some());

    let mut tx = pool.begin().await?;
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, DOC)
        .execute(&mut *tx)
        .await?;
    sync_one(&mut tx, EntityType::Document, DOC).await?;
    tx.commit().await?;
    assert_eq!(count(&pool).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn refuses_autocommit_and_stale_snapshot_isolation(pool: PgPool) -> Result<(), sqlx::Error> {
    let mut connection = pool.acquire().await?;
    assert!(matches!(
        sync_one(&mut connection, EntityType::Document, DOC).await,
        Err(sqlx::Error::InvalidArgument(_))
    ));
    let mut tx = pool.begin().await?;
    sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    assert!(matches!(
        sync_one(&mut tx, EntityType::Document, DOC).await,
        Err(sqlx::Error::InvalidArgument(_))
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn backfill_repairs_missing_and_orphaned_rows_and_can_restart(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    seed(&pool).await?;
    sqlx::query!(
        "INSERT INTO source_items (source_id, entity_type, kind, entity_id, grants) VALUES ('stale', 'document', 'document', 'deleted-by-old-writer', 1)"
    ).execute(&pool).await?;
    backfill::run(&pool).await?;
    assert_eq!(count(&pool).await?, 1);
    backfill::run(&pool).await?;
    assert_eq!(count(&pool).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_overlapping_grants_preserve_both_contributions(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    seed(&pool).await?;
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ('project', 'Project', 'owner')"#
    )
    .execute(&pool)
    .await?;
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let grant = |inherited: bool| {
        let pool = pool.clone();
        let barrier = barrier.clone();
        async move {
            let mut tx = pool.begin().await?;
            sqlx::query!(
                r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
                   VALUES ($1::text::uuid, 'document', 'viewer', 'user', 'view', $2)"#,
                DOC,
                inherited.then_some("project"),
            ).execute(&mut *tx).await?;
            barrier.wait().await;
            sync_one(&mut tx, EntityType::Document, DOC).await?;
            tx.commit().await
        }
    };
    let (first, second) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(grant(false), grant(true))
    })
    .await
    .unwrap();
    first?;
    second?;
    assert_eq!(
        sqlx::query_scalar!("SELECT grants FROM source_items WHERE source_id = 'viewer'")
            .fetch_one(&pool)
            .await?,
        2
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn project_cascade_refreshes_grants_on_surviving_items(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    seed(&pool).await?;
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ('parent', 'Parent', 'owner')"#
    )
    .execute(&pool)
    .await?;
    sqlx::query!(r#"INSERT INTO "Project" (id, name, "userId", "parentId") VALUES ('child', 'Child', 'owner', 'parent')"#).execute(&pool).await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
           VALUES ($1::text::uuid, 'document', 'viewer', 'user', 'view', 'child')"#, DOC,
    ).execute(&pool).await?;
    backfill::run(&pool).await?;
    let mut tx = pool.begin().await?;
    let affected = project_deletion::capture(&mut tx, &["parent".to_owned()]).await?;
    sqlx::query!(r#"DELETE FROM "Project" WHERE id = 'parent'"#)
        .execute(&mut *tx)
        .await?;
    sync_rows(&mut tx, &affected).await?;
    tx.commit().await?;
    assert_eq!(count(&pool).await?, 1);
    assert_eq!(
        sqlx::query_scalar!("SELECT source_id FROM source_items")
            .fetch_one(&pool)
            .await?,
        "owner"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_item_creation_and_grant_cannot_lose_the_projection(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let insert_item = async {
        let mut tx = pool.begin().await?;
        sqlx::query!(
            r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, 'Document', 'owner')"#,
            DOC
        )
        .execute(&mut *tx)
        .await?;
        barrier.wait().await;
        sync_one(&mut tx, EntityType::Document, DOC).await?;
        tx.commit().await
    };
    let insert_grant = async {
        let mut tx = pool.begin().await?;
        sqlx::query!(
            r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
               VALUES ($1::text::uuid, 'document', 'owner', 'user', 'owner')"#, DOC,
        ).execute(&mut *tx).await?;
        barrier.wait().await;
        sync_one(&mut tx, EntityType::Document, DOC).await?;
        tx.commit().await
    };
    let (item, grant) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(insert_item, insert_grant)
    })
    .await
    .unwrap();
    item?;
    grant?;
    assert_eq!(count(&pool).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn backfill_crosses_batch_boundaries_without_skipping_keys(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner)
           SELECT '10000000-0000-4000-8000-' || lpad(n::text, 12, '0'), 'Document', 'owner'
           FROM generate_series(1, 1200) n"#,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           SELECT id::uuid, 'document', 'owner', 'user', 'owner' FROM "Document""#,
    )
    .execute(&pool)
    .await?;
    assert_eq!(backfill::run(&pool).await?, 1200);
    assert_eq!(count(&pool).await?, 1200);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn refresh_before_update_does_not_deadlock_with_update_before_refresh(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    seed(&pool).await?;
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    // Saving a document updates its row, then refreshes it.
    let update_then_refresh = async {
        let mut tx = pool.begin().await?;
        sqlx::query!(
            r#"UPDATE "Document" SET "updatedAt" = NOW() WHERE id = $1"#,
            DOC
        )
        .execute(&mut *tx)
        .await?;
        barrier.wait().await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        sync_one(&mut tx, EntityType::Document, DOC).await?;
        tx.commit().await
    };
    // Editing a document's team share refreshes it, then updates its row.
    let refresh_then_update = async {
        let mut tx = pool.begin().await?;
        barrier.wait().await;
        sync_one(&mut tx, EntityType::Document, DOC).await?;
        sqlx::query!(
            r#"UPDATE "Document" SET name = 'Renamed' WHERE id = $1"#,
            DOC
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await
    };
    let (first, second) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(update_then_refresh, refresh_then_update)
    })
    .await
    .unwrap();
    first?;
    second?;
    assert_eq!(count(&pool).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bulk_refresh_relies_on_row_locks_alone(pool: PgPool) -> Result<(), sqlx::Error> {
    let items = ADVISORY_LOCK_LIMIT + 1;
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner)
           SELECT '10000000-0000-4000-8000-' || lpad(n::text, 12, '0'), 'Document', 'owner'
           FROM generate_series(1, $1) n"#,
        items,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           SELECT id::uuid, 'document', 'owner', 'user', 'owner' FROM "Document""#,
    )
    .execute(&pool)
    .await?;
    let ids = sqlx::query_scalar!(r#"SELECT id FROM "Document""#)
        .fetch_all(&pool)
        .await?;
    let mut tx = pool.begin().await?;
    sync_many(&mut tx, EntityType::Document, &ids).await?;
    let advisory = sqlx::query_scalar!(
        "SELECT count(*) FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'"
    )
    .fetch_one(&mut *tx)
    .await?;
    assert_eq!(advisory, Some(0));
    tx.commit().await?;
    assert_eq!(count(&pool).await?, i64::from(items));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn advisory_locks_stay_within_the_transaction_limit(pool: PgPool) -> Result<(), sqlx::Error> {
    let items = ADVISORY_LOCK_LIMIT + 10;
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner)
           SELECT '10000000-0000-4000-8000-' || lpad(n::text, 12, '0'), 'Document', 'owner'
           FROM generate_series(1, $1) n"#,
        items,
    )
    .execute(&pool)
    .await?;
    let ids = sqlx::query_scalar!(r#"SELECT id FROM "Document" ORDER BY id"#)
        .fetch_all(&pool)
        .await?;
    let advisory_locks = async |tx: &mut sqlx::PgConnection| {
        sqlx::query_scalar!(
            "SELECT count(*) FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'"
        )
        .fetch_one(tx)
        .await
    };
    // A folder upload refreshes each new item on its own.
    let mut tx = pool.begin().await?;
    for id in &ids {
        sync_one(&mut tx, EntityType::Document, id).await?;
    }
    assert_eq!(
        advisory_locks(&mut *tx).await?,
        Some(i64::from(ADVISORY_LOCK_LIMIT))
    );
    tx.commit().await?;
    // The total starts again in the next transaction.
    let mut tx = pool.begin().await?;
    sync_one(&mut tx, EntityType::Document, &ids[0]).await?;
    assert_eq!(advisory_locks(&mut *tx).await?, Some(1));
    tx.rollback().await?;
    Ok(())
}
