use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde_json::json;
use sqlx::{PgPool, Row};

use super::*;
use crate::domain::models::{ActionKind, AlreadyRunningError, Schedule, ScheduledAction};
use crate::domain::ports::ScheduledActionRepo;

const USER_A: &str = "macro|sched-a@macro.com";
const USER_B: &str = "macro|sched-b@macro.com";
const DAILY_9AM: &str = "0 0 9 * * *";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
    )
    .bind(macro_user_id)
    .bind(id)
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(id)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .expect("user should insert");
}

fn sample_action(owner: MacroUserIdStr<'static>, name: &str) -> ScheduledAction {
    let now = Utc::now();
    let schedule = Schedule::from_cron(DAILY_9AM.to_string()).expect("valid cron");
    let timezone = chrono_tz::UTC;
    let next_run_at = schedule
        .next_run_after_now(timezone)
        .expect("schedule has a future firing");
    ScheduledAction {
        id: None,
        owner,
        name: name.to_string(),
        schedule,
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        timezone,
        task: json!({}),
        claimed: None,
        next_run_at,
        enabled: true,
    }
}

async fn fetch_entity_row(pool: &PgPool, id: Uuid) -> sqlx::postgres::PgRow {
    sqlx::query(
        r#"
        SELECT
            owner_type::text AS owner_type,
            owner_id,
            entity_type,
            deleted_at
        FROM entity
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn entity_row_count(pool: &PgPool, id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM entity WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn scheduled_action_row_count(pool: &PgPool, id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM scheduled_action WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_action_returns_id_and_is_listable_by_owner(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);

    let created = repo
        .create_action(sample_action(user(USER_A), "standup"))
        .await
        .expect("create should succeed");
    assert!(created.id.is_some());

    let listed = repo
        .get_actions(user(USER_A))
        .await
        .expect("list should succeed");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "standup");
    assert_eq!(listed[0].id, created.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn other_owner_list_is_empty(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgScheduledActionRepo::new(pool);

    repo.create_action(sample_action(user(USER_A), "standup"))
        .await
        .expect("create should succeed");

    let owner_listed = repo
        .get_actions(user(USER_A))
        .await
        .expect("owner list should succeed");
    assert_eq!(owner_listed.len(), 1);

    let listed = repo
        .get_actions(user(USER_B))
        .await
        .expect("list should succeed");
    assert!(listed.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_action_changes_name_schedule_and_enabled(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);

    let created = repo
        .create_action(sample_action(user(USER_A), "standup"))
        .await
        .expect("create should succeed");

    let schedule = Schedule::from_cron("0 0 18 * * *".to_string()).expect("valid cron");
    let next_run_at = schedule
        .next_run_after_now(chrono_tz::UTC)
        .expect("schedule has a future firing");
    let updated = repo
        .update_action(ScheduledAction {
            name: "evening standup".to_string(),
            schedule,
            enabled: false,
            next_run_at,
            ..created
        })
        .await
        .expect("update should succeed");

    assert_eq!(updated.name, "evening standup");
    assert_eq!(updated.schedule.as_str(), "0 0 18 * * *");
    assert!(!updated.enabled);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn second_claim_returns_already_running(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);

    let created = repo
        .create_action(sample_action(user(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    repo.claim_action(&id)
        .await
        .expect("first claim should succeed");
    let error = repo
        .claim_action(&id)
        .await
        .expect_err("second claim should fail");
    assert!(error.downcast_ref::<AlreadyRunningError>().is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_action_removes_row_from_owner_list(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool.clone());

    let created = repo
        .create_action(sample_action(user(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    repo.delete_action(&id, user(USER_A))
        .await
        .expect("delete should succeed");

    let listed = repo
        .get_actions(user(USER_A))
        .await
        .expect("list should succeed");
    assert!(listed.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_action_registers_entity_row(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool.clone());

    let created = repo
        .create_action(sample_action(user(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    let row = fetch_entity_row(&pool, id).await;
    assert_eq!(row.get::<String, _>("entity_type"), "scheduled_action");
    assert_eq!(row.get::<String, _>("owner_type"), "user");
    assert_eq!(row.get::<String, _>("owner_id"), USER_A);
    assert_eq!(row.get::<Option<DateTime<Utc>>, _>("deleted_at"), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_action_removes_entity_row(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool.clone());

    let created = repo
        .create_action(sample_action(user(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    repo.delete_action(&id, user(USER_A))
        .await
        .expect("delete should succeed");

    assert_eq!(entity_row_count(&pool, id).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_action_succeeds_when_entity_row_is_missing(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool.clone());

    let created = repo
        .create_action(sample_action(user(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    sqlx::query("DELETE FROM entity WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .expect("entity row should delete");

    repo.delete_action(&id, user(USER_A))
        .await
        .expect("delete should succeed");

    assert_eq!(entity_row_count(&pool, id).await, 0);
    assert_eq!(scheduled_action_row_count(&pool, id).await, 0);
}
