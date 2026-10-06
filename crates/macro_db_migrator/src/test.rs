use super::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, migrate::Migrator};
use std::borrow::Cow;

const SCHEMA_DROP_VERSION: i64 = 20261002150422;

async fn before_drop(pool: &PgPool) {
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
