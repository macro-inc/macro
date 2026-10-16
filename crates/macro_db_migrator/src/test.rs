use super::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, migrate::Migrator};
use std::borrow::Cow;

/// CI clones every test database from a `template1` that already holds the macrodb
/// schema (`just setup_test_template`). These tests build their own schema, so they
/// start from an empty `public` schema.
const EMPTY_PUBLIC_SCHEMA: &str = "DROP SCHEMA public CASCADE; CREATE SCHEMA public;";

const SCHEMA_DROP_VERSION: i64 = 20261002150422;
const OUTLOOK_RUNTIME_VERSION: i64 = 20261004022345;

async fn before_drop(pool: &PgPool) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(pool)
        .await
        .unwrap();
    let migrator = Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < SCHEMA_DROP_VERSION)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    migrator.run(pool).await.unwrap();
    // These fixture queries intentionally target the historical schema, which
    // cannot be checked against the current compile-time database.
    sqlx::raw_sql(include_str!("test/before_schema_drop.sql"))
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = false)]
async fn schema_drop_preserves_imported_rows_and_parent_cascades(pool: PgPool) {
    before_drop(&pool).await;
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    sqlx::raw_sql(include_str!("test/after_schema_drop.sql"))
        .execute(&pool)
        .await
        .unwrap();
    // The SQLx migration ledger must also make subsequent runs no-ops.
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn schema_drop_rejects_rootless_placeables_atomically(pool: PgPool) {
    before_drop(&pool).await;
    sqlx::raw_sql(r#"UPDATE "PdfPlaceableCommentAnchor" SET root_id = NULL"#)
        .execute(&pool)
        .await
        .unwrap();
    assert!(MACRO_DB_MIGRATIONS.run(&pool).await.is_err());
    // PostgreSQL rolls back the preceding function/column changes as well.
    sqlx::raw_sql(
        r#"SELECT channel_id FROM comms_messages;
           SELECT "threadId" FROM "PdfPlaceableCommentAnchor";
           SELECT * FROM "Comment";
           SELECT 'sync_comms_message_parent()'::regprocedure;"#,
    )
    .execute(&pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = false)]
async fn outlook_schema_lock_timeout_rolls_back_and_can_be_retried(pool: PgPool) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(&pool)
        .await
        .unwrap();
    let mut migrator = Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < OUTLOOK_RUNTIME_VERSION)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    migrator.run(&pool).await.unwrap();

    // A normal email writer holds this lock until it commits. The migration
    // must give up promptly and roll back the earlier schema changes too.
    let mut writer = pool.begin().await.unwrap();
    sqlx::raw_sql("LOCK TABLE email_messages IN ROW EXCLUSIVE MODE")
        .execute(&mut *writer)
        .await
        .unwrap();
    migrator.migrations.to_mut().push(
        MACRO_DB_MIGRATIONS
            .iter()
            .find(|migration| {
                migration.version == OUTLOOK_RUNTIME_VERSION
                    && !migration.migration_type.is_down_migration()
            })
            .unwrap()
            .clone(),
    );
    let mut migration_connection = pool.acquire().await.unwrap();
    let error = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        migrator.run(&mut *migration_connection),
    )
    .await
    .expect("schema migration must not wait indefinitely for a writer")
    .expect_err("the writer must prevent the schema lock");
    assert!(error.to_string().contains("lock timeout"), "{error}");
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'email_links'
               AND column_name = 'sync_generation'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    // A failed CLI migration exits its session, releasing SQLx's advisory lock.
    migration_connection.close().await.unwrap();
    writer.rollback().await.unwrap();
    migrator.run(&pool).await.unwrap();
    migrator.run(&pool).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn outlook_online_migrations_preserve_existing_mail_and_reminders(pool: PgPool) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(&pool)
        .await
        .unwrap();
    let before_outlook = Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < OUTLOOK_RUNTIME_VERSION)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    before_outlook.run(&pool).await.unwrap();
    // This fixture intentionally targets the historical schema, before the
    // provider columns and reminder methods exist.
    sqlx::raw_sql(include_str!("test/before_outlook.sql"))
        .execute(&pool)
        .await
        .unwrap();
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    sqlx::raw_sql(include_str!("test/after_outlook.sql"))
        .execute(&pool)
        .await
        .unwrap();
}
