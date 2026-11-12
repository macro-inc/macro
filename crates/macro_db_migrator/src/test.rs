use super::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, migrate::Migrator, types::Uuid};
use std::borrow::Cow;

/// CI clones every test database from a `template1` that already holds the macrodb
/// schema (`just setup_test_template`). These tests build their own schema, so they
/// start from an empty `public` schema.
const EMPTY_PUBLIC_SCHEMA: &str = "DROP SCHEMA public CASCADE; CREATE SCHEMA public;";

const SCHEMA_DROP_VERSION: i64 = 20261002150422;
const EMAIL_DELIVERY_VERSION: i64 = 20261015141405;

#[sqlx::test(migrations = false)]
async fn email_delivery_upgrade_preserves_existing_schedules_and_attachments(pool: PgPool) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(&pool)
        .await
        .unwrap();
    let before_delivery = Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < EMAIL_DELIVERY_VERSION)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    before_delivery.run(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../email_db_client/fixtures/get_process_scheduled_messages.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!("test/before_email_delivery.sql"))
        .execute(&pool)
        .await
        .unwrap();
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    sqlx::raw_sql(include_str!("test/after_email_delivery.sql"))
        .execute(&pool)
        .await
        .unwrap();
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
}
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

#[sqlx::test(migrations = false)]
async fn generic_call_entities_preserve_native_identity_and_optional_resources(pool: PgPool) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(&pool)
        .await
        .unwrap();
    let before_calls = Migrator {
        migrations: Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|migration| migration.version < 20261006214256)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    before_calls.run(&pool).await.unwrap();
    // Multi-statement migration fixtures intentionally exercise both historical
    // and current schemas, including constraint failures inside savepoints.
    sqlx::raw_sql(include_str!("test/call_entities_before.sql"))
        .execute(&pool)
        .await
        .unwrap();
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
    sqlx::raw_sql(include_str!("test/call_entities_after.sql"))
        .execute(&pool)
        .await
        .unwrap();
    MACRO_DB_MIGRATIONS.run(&pool).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn explicit_primary_preserves_legacy_writes_and_crm_consent_guard(pool: PgPool) {
    let owner = "macro|legacy@example.com";
    let link = Uuid::new_v4();
    let team = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)",
        Uuid::new_v4(),
        owner,
        "legacy@example.com",
        "crm-guard-fixture"
    )
    .execute(&pool)
    .await
    .unwrap();
    let macro_user = sqlx::query_scalar!(
        "SELECT id FROM macro_user WHERE email = $1",
        "legacy@example.com"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO \"User\" (id, email, macro_user_id) VALUES ($1, $2, $3)",
        owner,
        "legacy@example.com",
        macro_user
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'CRM guard fixture', $2)",
        team,
        owner
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        owner
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES ($1, $2, $3, $4, 'GMAIL')",
        link,
        owner,
        "legacy-fusion-user",
        "legacy@example.com"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        sqlx::query_scalar!("SELECT is_primary FROM email_links WHERE id = $1", link)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "an old writer that omits is_primary keeps the legacy primary predicate"
    );
    sqlx::query!(
        "INSERT INTO crm_email_consent (team_id, user_id, link_id, enabled) VALUES ($1, $2, $3, true)",
        team,
        owner,
        link
    )
    .execute(&pool)
    .await
    .unwrap();

    let link_id = link.to_string();
    for lifecycle_change in [
        "UPDATE email_links SET is_primary = false".to_owned(),
        "UPDATE email_links SET is_primary = true".to_owned(),
        "UPDATE email_links SET macro_id = 'macro|other@example.com'".to_owned(),
        "UPDATE email_links SET macro_id = 'macro|legacy@example.com', email_address = 'changed@example.com'".to_owned(),
        "UPDATE email_links SET deleting_at = now()".to_owned(),
        "UPDATE email_links SET deleting_at = NULL, disconnect_requested_at = now()".to_owned(),
        "UPDATE email_links SET disconnect_requested_at = NULL, needs_reauth = true".to_owned(),
    ] {
        sqlx::query!("UPDATE crm_email_consent SET enabled = true WHERE link_id = $1", link)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(&format!("{lifecycle_change} WHERE id = '{link_id}'"))
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            !sqlx::query_scalar!("SELECT enabled FROM crm_email_consent WHERE link_id = $1", link)
                .fetch_one(&pool)
                .await
                .unwrap(),
            "consent survived lifecycle change: {lifecycle_change}"
        );
    }

    sqlx::raw_sql(&format!(
        "UPDATE email_links SET is_primary = true, deleting_at = NULL, disconnect_requested_at = NULL, needs_reauth = false WHERE id = '{link_id}'"
    ))
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !sqlx::query_scalar!(
            "SELECT enabled FROM crm_email_consent WHERE link_id = $1",
            link
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "returning to a connected primary mailbox cannot resurrect an old grant"
    );
}
