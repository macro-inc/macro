use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_owner::{Owner, OwnerType};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use super::{NewEntityRecord, RegisteredEntityType, insert_entity};

const OWNER: &str = "macro|backfill-t27@example.com";
const OTHER_OWNER: &str = "macro|backfill-t27-other@example.com";
const SYSTEM_BOT_ID: Uuid = Uuid::from_u128(0xa9e7);

const DOCUMENT_ID: Uuid = Uuid::from_u128(0x10);
const PROJECT_ID: Uuid = Uuid::from_u128(0x20);
const CHAT_ID: Uuid = Uuid::from_u128(0x30);
const AGENT_SESSION_ID: Uuid = Uuid::from_u128(0x40);
const SCHEDULED_ACTION_ID: Uuid = Uuid::from_u128(0x50);
const CONFLICT_DOCUMENT_ID: Uuid = Uuid::from_u128(0x60);

fn ts(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339)
        .unwrap()
        .with_timezone(&Utc)
}

fn user_owner(id: &str) -> Owner {
    Owner::parse(OwnerType::User, id).unwrap()
}

// Read the shipped migration files so this test cannot drift from the INSERT they run.
fn backfill_sql() -> Vec<String> {
    let migrations_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("crates/macro_db_client/migrations");
    let mut paths: Vec<PathBuf> = fs::read_dir(&migrations_dir)
        .unwrap()
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let name = path.file_name()?.to_str()?;
            if name.contains("backfill_entity_") && name.ends_with(".sql") {
                Some(path)
            } else {
                None
            }
        })
        .collect();
    paths.sort();
    assert_eq!(
        paths.len(),
        5,
        "expected five backfill_entity_*.sql migration files"
    );
    paths
        .into_iter()
        .map(|path| fs::read_to_string(path).unwrap())
        .collect()
}

async fn run_backfill_sql(pool: &PgPool) {
    for sql in backfill_sql() {
        sqlx::query(&sql).execute(pool).await.unwrap();
    }
}

async fn insert_user(pool: &PgPool, user_id: &str, macro_user_id: Uuid) {
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);
    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(macro_user_id)
    .bind(email)
    .bind(email)
    .bind(format!("stripe_{email}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(email)
    .bind(macro_user_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_source_rows(pool: &PgPool) {
    sqlx::query(
        r#"
        INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt", "deletedAt")
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(DOCUMENT_ID.to_string())
    .bind("Backfill Document")
    .bind(OWNER)
    .bind(ts("2024-01-01T10:00:00Z"))
    .bind(ts("2024-01-02T11:00:00Z"))
    .bind(ts("2024-01-03T12:00:00Z"))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO "Project" (id, name, "userId", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(PROJECT_ID.to_string())
    .bind("Backfill Project")
    .bind(OWNER)
    .bind(ts("2024-02-01T10:00:00Z"))
    .bind(ts("2024-02-02T11:00:00Z"))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO "Chat" (id, "userId", name, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(CHAT_ID.to_string())
    .bind(OWNER)
    .bind("Backfill Chat")
    .bind(ts("2024-03-01T10:00:00Z"))
    .bind(ts("2024-03-02T11:00:00Z"))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO agent_session (
            id, owner_id, bot_id, model, harness, workspace, created_at, modified_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(AGENT_SESSION_ID)
    .bind(OWNER)
    .bind(SYSTEM_BOT_ID)
    .bind("claude-sonnet-5")
    .bind("claude-code")
    .bind("/workspace")
    .bind(ts("2024-04-01T10:00:00Z"))
    .bind(ts("2024-04-02T11:00:00Z"))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO scheduled_action (
            id, owner, name, schedule, kind, timezone, task,
            next_run_at, enabled, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
        "#,
    )
    .bind(SCHEDULED_ACTION_ID)
    .bind(OWNER)
    .bind("Backfill Action")
    .bind("0 0 9 * * *")
    .bind("Agent")
    .bind("UTC")
    .bind("{}")
    .bind(ts("2024-05-03T09:00:00Z"))
    .bind(true)
    .bind(ts("2024-05-01T10:00:00Z"))
    .bind(ts("2024-05-02T11:00:00Z"))
    .execute(pool)
    .await
    .unwrap();
}

async fn missing_entity_count(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn entity_row_count(pool: &PgPool, id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM entity WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn fetch_entity(
    pool: &PgPool,
    id: Uuid,
) -> (
    String,
    String,
    String,
    DateTime<Utc>,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
) {
    let row = sqlx::query(
        r#"
        SELECT
            entity_type,
            owner_type::text AS owner_type,
            owner_id,
            created_at,
            updated_at,
            deleted_at
        FROM entity
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap();
    (
        row.get("entity_type"),
        row.get("owner_type"),
        row.get("owner_id"),
        row.get("created_at"),
        row.get("updated_at"),
        row.get("deleted_at"),
    )
}

async fn source_matches_entity(pool: &PgPool, sql: &str, id: Uuid) -> bool {
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn backfill_copies_existing_resource_rows_and_is_idempotent(pool: PgPool) {
    insert_user(&pool, OWNER, Uuid::from_u128(0x100)).await;
    insert_source_rows(&pool).await;
    run_backfill_sql(&pool).await;

    let document_missing = missing_entity_count(
        &pool,
        r#"
        SELECT count(*)
        FROM "Document" d
        WHERE d.id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          AND d.owner LIKE 'macro|%'
          AND NOT EXISTS (SELECT 1 FROM entity e WHERE e.id = d.id::uuid)
        "#,
    )
    .await;
    assert_eq!(document_missing, 0, "every Document has an entity row");

    let project_missing = missing_entity_count(
        &pool,
        r#"
        SELECT count(*)
        FROM "Project" p
        WHERE p.id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          AND p."userId" LIKE 'macro|%'
          AND NOT EXISTS (SELECT 1 FROM entity e WHERE e.id = p.id::uuid)
        "#,
    )
    .await;
    assert_eq!(project_missing, 0, "every Project has an entity row");

    let chat_missing = missing_entity_count(
        &pool,
        r#"
        SELECT count(*)
        FROM "Chat" c
        WHERE c.id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          AND c."userId" LIKE 'macro|%'
          AND NOT EXISTS (SELECT 1 FROM entity e WHERE e.id = c.id::uuid)
        "#,
    )
    .await;
    assert_eq!(chat_missing, 0, "every Chat has an entity row");

    let agent_session_missing = missing_entity_count(
        &pool,
        r#"
        SELECT count(*)
        FROM agent_session a
        WHERE NOT EXISTS (SELECT 1 FROM entity e WHERE e.id = a.id)
        "#,
    )
    .await;
    assert_eq!(
        agent_session_missing, 0,
        "every agent_session has an entity row"
    );

    let scheduled_action_missing = missing_entity_count(
        &pool,
        r#"
        SELECT count(*)
        FROM scheduled_action s
        WHERE NOT EXISTS (SELECT 1 FROM entity e WHERE e.id = s.id)
        "#,
    )
    .await;
    assert_eq!(
        scheduled_action_missing, 0,
        "every scheduled_action has an entity row"
    );

    let (entity_type, owner_type, owner_id, created_at, updated_at, deleted_at) =
        fetch_entity(&pool, DOCUMENT_ID).await;
    assert_eq!(entity_type, "document");
    assert_eq!(owner_type, "user");
    assert_eq!(owner_id, OWNER);
    assert_eq!(created_at, ts("2024-01-01T10:00:00Z"));
    assert_eq!(updated_at, ts("2024-01-02T11:00:00Z"));
    assert_eq!(deleted_at, Some(ts("2024-01-03T12:00:00Z")));
    assert!(
        source_matches_entity(
            &pool,
            r#"
            SELECT e.created_at = d."createdAt"
               AND e.updated_at = d."updatedAt"
               AND e.deleted_at IS NOT DISTINCT FROM d."deletedAt"
            FROM entity e
            JOIN "Document" d ON d.id::uuid = e.id
            WHERE e.id = $1
            "#,
            DOCUMENT_ID,
        )
        .await,
        "document timestamps match the source row"
    );

    let (entity_type, owner_type, owner_id, created_at, updated_at, deleted_at) =
        fetch_entity(&pool, PROJECT_ID).await;
    assert_eq!(entity_type, "project");
    assert_eq!(owner_type, "user");
    assert_eq!(owner_id, OWNER);
    assert_eq!(created_at, ts("2024-02-01T10:00:00Z"));
    assert_eq!(updated_at, ts("2024-02-02T11:00:00Z"));
    assert_eq!(deleted_at, None);
    assert!(
        source_matches_entity(
            &pool,
            r#"
            SELECT e.created_at = p."createdAt"
               AND e.updated_at = p."updatedAt"
               AND e.deleted_at IS NOT DISTINCT FROM p."deletedAt"
            FROM entity e
            JOIN "Project" p ON p.id::uuid = e.id
            WHERE e.id = $1
            "#,
            PROJECT_ID,
        )
        .await,
        "project timestamps match the source row"
    );

    let (entity_type, owner_type, owner_id, created_at, updated_at, deleted_at) =
        fetch_entity(&pool, CHAT_ID).await;
    assert_eq!(entity_type, "chat");
    assert_eq!(owner_type, "user");
    assert_eq!(owner_id, OWNER);
    assert_eq!(created_at, ts("2024-03-01T10:00:00Z"));
    assert_eq!(updated_at, ts("2024-03-02T11:00:00Z"));
    assert_eq!(deleted_at, None);
    assert!(
        source_matches_entity(
            &pool,
            r#"
            SELECT e.created_at = c."createdAt"
               AND e.updated_at = c."updatedAt"
               AND e.deleted_at IS NOT DISTINCT FROM c."deletedAt"
            FROM entity e
            JOIN "Chat" c ON c.id::uuid = e.id
            WHERE e.id = $1
            "#,
            CHAT_ID,
        )
        .await,
        "chat timestamps match the source row"
    );

    let (entity_type, owner_type, owner_id, created_at, updated_at, deleted_at) =
        fetch_entity(&pool, AGENT_SESSION_ID).await;
    assert_eq!(entity_type, "agent_session");
    assert_eq!(owner_type, "user");
    assert_eq!(owner_id, OWNER);
    assert_eq!(created_at, ts("2024-04-01T10:00:00Z"));
    assert_eq!(updated_at, ts("2024-04-02T11:00:00Z"));
    assert_eq!(deleted_at, None);
    assert!(
        source_matches_entity(
            &pool,
            r#"
            SELECT e.created_at = a.created_at
               AND e.updated_at = a.modified_at
               AND e.deleted_at IS NULL
            FROM entity e
            JOIN agent_session a ON a.id = e.id
            WHERE e.id = $1
            "#,
            AGENT_SESSION_ID,
        )
        .await,
        "agent_session timestamps match the source row"
    );

    let (entity_type, owner_type, owner_id, created_at, updated_at, deleted_at) =
        fetch_entity(&pool, SCHEDULED_ACTION_ID).await;
    assert_eq!(entity_type, "scheduled_action");
    assert_eq!(owner_type, "user");
    assert_eq!(owner_id, OWNER);
    assert_eq!(created_at, ts("2024-05-01T10:00:00Z"));
    assert_eq!(updated_at, ts("2024-05-02T11:00:00Z"));
    assert_eq!(deleted_at, None);
    assert!(
        source_matches_entity(
            &pool,
            r#"
            SELECT e.created_at = s.created_at
               AND e.updated_at = s.updated_at
               AND e.deleted_at IS NULL
            FROM entity e
            JOIN scheduled_action s ON s.id = e.id
            WHERE e.id = $1
            "#,
            SCHEDULED_ACTION_ID,
        )
        .await,
        "scheduled_action timestamps match the source row"
    );

    run_backfill_sql(&pool).await;
    assert_eq!(entity_row_count(&pool, DOCUMENT_ID).await, 1);
    assert_eq!(entity_row_count(&pool, PROJECT_ID).await, 1);
    assert_eq!(entity_row_count(&pool, CHAT_ID).await, 1);
    assert_eq!(entity_row_count(&pool, AGENT_SESSION_ID).await, 1);
    assert_eq!(entity_row_count(&pool, SCHEDULED_ACTION_ID).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn backfill_leaves_a_preexisting_entity_owner_unchanged(pool: PgPool) {
    insert_user(&pool, OWNER, Uuid::from_u128(0x100)).await;
    insert_user(&pool, OTHER_OWNER, Uuid::from_u128(0x101)).await;

    let mut tx: Transaction<'_, Postgres> = pool.begin().await.unwrap();
    insert_entity(
        &mut tx,
        NewEntityRecord::new(
            CONFLICT_DOCUMENT_ID,
            RegisteredEntityType::Document,
            user_owner(OWNER),
        ),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    sqlx::query(
        r#"
        INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(CONFLICT_DOCUMENT_ID.to_string())
    .bind("Conflicting Document")
    .bind(OTHER_OWNER)
    .bind(ts("2024-06-01T10:00:00Z"))
    .bind(ts("2024-06-02T11:00:00Z"))
    .execute(&pool)
    .await
    .unwrap();

    run_backfill_sql(&pool).await;

    let (_entity_type, owner_type, owner_id, _created_at, _updated_at, _deleted_at) =
        fetch_entity(&pool, CONFLICT_DOCUMENT_ID).await;
    assert_eq!(owner_type, "user");
    assert_eq!(owner_id, OWNER);
    assert_eq!(entity_row_count(&pool, CONFLICT_DOCUMENT_ID).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn backfill_skips_rows_that_cannot_be_registered(pool: PgPool) {
    const LEGACY_OWNER: &str = "legacy|backfill-t27@example.com";
    const LEGACY_DOCUMENT_ID: &str = "legacy-doc-not-uuid";
    const LEGACY_OWNED_DOCUMENT_ID: Uuid = Uuid::from_u128(0x70);

    insert_user(&pool, OWNER, Uuid::from_u128(0x100)).await;
    insert_user(&pool, LEGACY_OWNER, Uuid::from_u128(0x102)).await;
    insert_source_rows(&pool).await;

    sqlx::query(
        r#"
        INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(LEGACY_DOCUMENT_ID)
    .bind("Legacy Id Document")
    .bind(OWNER)
    .bind(ts("2024-07-01T10:00:00Z"))
    .bind(ts("2024-07-02T11:00:00Z"))
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(LEGACY_OWNED_DOCUMENT_ID.to_string())
    .bind("Legacy Owner Document")
    .bind(LEGACY_OWNER)
    .bind(ts("2024-07-03T10:00:00Z"))
    .bind(ts("2024-07-04T11:00:00Z"))
    .execute(&pool)
    .await
    .unwrap();

    run_backfill_sql(&pool).await;

    assert_eq!(entity_row_count(&pool, DOCUMENT_ID).await, 1);
    assert_eq!(entity_row_count(&pool, LEGACY_OWNED_DOCUMENT_ID).await, 0);
    let document_entity_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM entity WHERE entity_type = 'document'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        document_entity_count, 1,
        "only UUID-id macro-owned documents are registered"
    );
}
