use super::*;
use crate::links::delete::mark_link_deleting;
use crate::links::get::fetch_link_by_id;
use crate::links::insert::upsert_link;
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::link::{Link, UserProvider};
use sqlx::{Pool, Postgres};

async fn insert_test_link(pool: &Pool<Postgres>, email: &str) -> anyhow::Result<Uuid> {
    let link = Link {
        id: macro_uuid::generate_uuid_v7(),
        macro_id: MacroUserIdStr::try_from(format!("macro|{email}"))?,
        fusionauth_user_id: "22222222-2222-2222-2222-222222222222".to_string(),
        email_address: EmailStr::try_from(email.to_string())?,
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    };
    let mut conn = pool.acquire().await?;
    let inserted = upsert_link(&mut conn, link).await?;
    Ok(inserted.id)
}

async fn set_last_active_days_ago(
    pool: &Pool<Postgres>,
    link_id: Uuid,
    days: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_links SET last_active_at = NOW() - make_interval(days => $2) WHERE id = $1",
        link_id,
        days,
    )
    .execute(pool)
    .await?;
    Ok(())
}

struct RetentionState {
    is_sync_active: bool,
    sync_paused_at: Option<DateTime<Utc>>,
    last_active_at: DateTime<Utc>,
}

async fn retention_state(pool: &Pool<Postgres>, link_id: Uuid) -> anyhow::Result<RetentionState> {
    Ok(sqlx::query_as!(
        RetentionState,
        "SELECT is_sync_active, sync_paused_at, last_active_at FROM email_links WHERE id = $1",
        link_id,
    )
    .fetch_one(pool)
    .await?)
}

fn week_ago() -> DateTime<Utc> {
    Utc::now() - Duration::days(7)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pause_stops_sync_for_idle_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "idle@retention.test").await?;
    set_last_active_days_ago(&pool, id, 8).await?;

    assert!(pause_link_sync(&pool, id, week_ago()).await?);

    let state = retention_state(&pool, id).await?;
    assert!(!state.is_sync_active);
    assert!(state.sync_paused_at.is_some());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pause_skips_link_active_since_the_sweep(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "returned@retention.test").await?;

    assert!(!pause_link_sync(&pool, id, week_ago()).await?);

    let state = retention_state(&pool, id).await?;
    assert!(state.is_sync_active);
    assert!(state.sync_paused_at.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pause_redelivery_keeps_the_original_pause_time(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "redelivered@retention.test").await?;
    set_last_active_days_ago(&pool, id, 8).await?;

    assert!(pause_link_sync(&pool, id, week_ago()).await?);
    let first = retention_state(&pool, id).await?.sync_paused_at;

    assert!(pause_link_sync(&pool, id, week_ago()).await?);
    assert_eq!(retention_state(&pool, id).await?.sync_paused_at, first);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pause_skips_link_being_deleted(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "deleting@retention.test").await?;
    set_last_active_days_ago(&pool, id, 8).await?;
    mark_link_deleting(&pool, id).await?;

    assert!(!pause_link_sync(&pool, id, week_ago()).await?);
    assert!(retention_state(&pool, id).await?.sync_paused_at.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activity_resumes_paused_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let paused = insert_test_link(&pool, "paused@retention.test").await?;
    let active = insert_test_link(&pool, "active@retention.test").await?;
    set_last_active_days_ago(&pool, paused, 8).await?;
    pause_link_sync(&pool, paused, week_ago()).await?;

    let resumed = record_link_activity(&pool, &[paused, active]).await?;

    assert_eq!(resumed, vec![paused]);
    let state = retention_state(&pool, paused).await?;
    assert!(state.is_sync_active);
    assert!(state.sync_paused_at.is_none());
    assert!(state.last_active_at > Utc::now() - Duration::minutes(1));
    let link = fetch_link_by_id(&pool, paused).await?.expect("link exists");
    assert!(link.is_sync_active);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activity_refreshes_stale_timestamp_without_resuming(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "stale@retention.test").await?;
    set_last_active_days_ago(&pool, id, 3).await?;

    assert!(record_link_activity(&pool, &[id]).await?.is_empty());

    let state = retention_state(&pool, id).await?;
    assert!(state.is_sync_active);
    assert!(state.last_active_at > Utc::now() - Duration::minutes(1));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activity_writes_at_most_hourly(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "hourly@retention.test").await?;
    let before = retention_state(&pool, id).await?.last_active_at;

    record_link_activity(&pool, &[id]).await?;

    assert_eq!(retention_state(&pool, id).await?.last_active_at, before);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activity_does_not_resume_link_being_deleted(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "torn-down@retention.test").await?;
    set_last_active_days_ago(&pool, id, 8).await?;
    pause_link_sync(&pool, id, week_ago()).await?;
    mark_link_deleting(&pool, id).await?;

    assert!(record_link_activity(&pool, &[id]).await?.is_empty());
    assert!(!retention_state(&pool, id).await?.is_sync_active);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_resume_restores_pause_for_next_activity(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "unsent-resume@retention.test").await?;
    set_last_active_days_ago(&pool, id, 8).await?;
    pause_link_sync(&pool, id, week_ago()).await?;
    assert_eq!(record_link_activity(&pool, &[id]).await?, vec![id]);

    assert!(restore_link_pause(&pool, id).await?);
    let state = retention_state(&pool, id).await?;
    assert!(!state.is_sync_active);
    assert!(state.sync_paused_at.is_some());

    assert_eq!(record_link_activity(&pool, &[id]).await?, vec![id]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn restore_pause_skips_link_being_deleted(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "restore-deleting@retention.test").await?;
    mark_link_deleting(&pool, id).await?;

    assert!(!restore_link_pause(&pool, id).await?);
    assert!(retention_state(&pool, id).await?.sync_paused_at.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retention_delete_claims_paused_link_and_blocks_resume(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "expired@retention.test").await?;
    set_last_active_days_ago(&pool, id, 31).await?;
    pause_link_sync(&pool, id, week_ago()).await?;

    assert!(claim_idle_link_for_deletion(&pool, id).await?);
    mark_link_deleting(&pool, id).await?;
    assert!(
        claim_idle_link_for_deletion(&pool, id).await?,
        "a redelivered delete still proceeds"
    );

    assert!(record_link_activity(&pool, &[id]).await?.is_empty());
    let state = retention_state(&pool, id).await?;
    assert!(!state.is_sync_active);
    assert!(state.sync_paused_at.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retention_delete_skips_link_resumed_since_the_sweep(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "came-back@retention.test").await?;
    set_last_active_days_ago(&pool, id, 31).await?;
    pause_link_sync(&pool, id, week_ago()).await?;
    record_link_activity(&pool, &[id]).await?;

    assert!(!claim_idle_link_for_deletion(&pool, id).await?);
    assert!(retention_state(&pool, id).await?.is_sync_active);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_clears_pause(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = insert_test_link(&pool, "reconnect@retention.test").await?;
    set_last_active_days_ago(&pool, id, 8).await?;
    pause_link_sync(&pool, id, week_ago()).await?;

    insert_test_link(&pool, "reconnect@retention.test").await?;

    let state = retention_state(&pool, id).await?;
    assert!(state.is_sync_active);
    assert!(state.sync_paused_at.is_none());
    assert!(state.last_active_at > Utc::now() - Duration::minutes(1));
    Ok(())
}
