//! Tests for the refresh sweep query logic, run against a live macrodb.
//!
//! These exercise `delete_inactive` and `claim_stale` directly (the SQS enqueue
//! step is a thin wrapper over `sqs_client` and needs no DB).

use chrono::{DateTime, Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::*;

/// Inserts a projection definition with the given cadence/expiry.
async fn insert_projection(
    pool: &Pool<Postgres>,
    id: &str,
    refresh_cadence: &str,
    expiry: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO ai_projection (id, prompt, prompt_hash, target_type, refresh_cadence, expiry)
        VALUES ($1, 'prompt', 'hash_v1', 'user', $2, $3)
        "#,
        id,
        refresh_cadence,
        expiry,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Inserts a per-target instance with explicit timestamps and status.
#[allow(clippy::too_many_arguments)]
async fn insert_instance(
    pool: &Pool<Postgres>,
    ai_projection_id: &str,
    target_id: &str,
    status: &str,
    generated_at: Option<DateTime<Utc>>,
    stale_at: Option<DateTime<Utc>>,
    last_requested_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO user_ai_projection
            (ai_projection_id, target_id, prompt_hash, status,
             generated_at, stale_at, last_requested_at, updated_at)
        VALUES ($1, $2, 'hash_v1', $3, $4, $5, $6, $7)
        "#,
        ai_projection_id,
        target_id,
        status,
        generated_at,
        stale_at,
        last_requested_at,
        updated_at,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Reads back an instance's status.
async fn status_of(
    pool: &Pool<Postgres>,
    ai_projection_id: &str,
    target_id: &str,
) -> anyhow::Result<Option<String>> {
    let status = sqlx::query_scalar!(
        r#"
        SELECT status FROM user_ai_projection
        WHERE ai_projection_id = $1 AND target_id = $2
        "#,
        ai_projection_id,
        target_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(status)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_inactive_removes_only_inactive_of_cadence(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_projection(&pool, "high/day", "high", "day").await?;
    insert_projection(&pool, "low/day", "low", "day").await?;

    let now = Utc::now();
    let stale = Some(now - Duration::hours(1));
    let generated = Some(now - Duration::days(2));

    // Inactive (not requested in 2 days, day expiry) -> should be deleted.
    insert_instance(
        &pool,
        "high/day",
        "inactive",
        "ready",
        generated,
        stale,
        now - Duration::days(2),
        now - Duration::days(2),
    )
    .await?;
    // Inactive but a different cadence -> the high sweep must not touch it.
    insert_instance(
        &pool,
        "low/day",
        "inactive_low",
        "ready",
        generated,
        stale,
        now - Duration::days(2),
        now - Duration::days(2),
    )
    .await?;
    // Active (requested just now) -> must survive.
    insert_instance(
        &pool, "high/day", "active", "ready", generated, stale, now, now,
    )
    .await?;
    // Cold and inactive -> deletion applies regardless of status.
    insert_instance(
        &pool,
        "high/day",
        "cold_inactive",
        "cold",
        None,
        None,
        now - Duration::days(5),
        now - Duration::days(5),
    )
    .await?;

    let deleted = delete_inactive(&pool, RefreshCadence::High).await?;
    assert_eq!(
        deleted, 2,
        "inactive ready + inactive cold of the high cadence"
    );

    assert_eq!(status_of(&pool, "high/day", "inactive").await?, None);
    assert_eq!(status_of(&pool, "high/day", "cold_inactive").await?, None);
    assert_eq!(
        status_of(&pool, "high/day", "active").await?.as_deref(),
        Some("ready")
    );
    // Untouched: belongs to the low cadence.
    assert_eq!(
        status_of(&pool, "low/day", "inactive_low")
            .await?
            .as_deref(),
        Some("ready")
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claim_stale_selects_and_marks_refreshing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_projection(&pool, "high/day", "high", "day").await?;
    insert_projection(&pool, "med/day", "medium", "day").await?;

    let now = Utc::now();
    let generated = Some(now - Duration::hours(2));
    let stale_past = Some(now - Duration::hours(1));
    let stale_future = Some(now + Duration::hours(1));
    let active = now; // requested recently

    // stale + active + ready -> claimed.
    insert_instance(
        &pool,
        "high/day",
        "ready_stale",
        "ready",
        generated,
        stale_past,
        active,
        now,
    )
    .await?;
    // stale + active + error -> claimed (we retry errored instances).
    insert_instance(
        &pool,
        "high/day",
        "error_stale",
        "error",
        generated,
        stale_past,
        active,
        now,
    )
    .await?;
    // stale + active + loading -> in flight, skipped.
    insert_instance(
        &pool,
        "high/day",
        "loading_stale",
        "loading",
        generated,
        stale_past,
        active,
        now,
    )
    .await?;
    // stale + active + cold -> freshly queued, skipped.
    insert_instance(
        &pool,
        "high/day",
        "cold_stale",
        "cold",
        None,
        stale_past,
        active,
        now,
    )
    .await?;
    // hot (stale_at in the future) + ready -> left alone.
    insert_instance(
        &pool,
        "high/day",
        "ready_hot",
        "ready",
        generated,
        stale_future,
        active,
        now,
    )
    .await?;
    // refreshing but stuck > 15 min + stale -> reclaimed.
    insert_instance(
        &pool,
        "high/day",
        "stuck_refreshing",
        "refreshing",
        generated,
        stale_past,
        active,
        now - Duration::minutes(20),
    )
    .await?;
    // refreshing recently (< 15 min) -> still in flight, skipped.
    insert_instance(
        &pool,
        "high/day",
        "fresh_refreshing",
        "refreshing",
        generated,
        stale_past,
        active,
        now - Duration::minutes(2),
    )
    .await?;
    // stale + ready but a different cadence -> not touched by the high sweep.
    insert_instance(
        &pool,
        "med/day",
        "other_cadence",
        "ready",
        generated,
        stale_past,
        active,
        now,
    )
    .await?;

    let mut claimed = claim_stale(&pool, RefreshCadence::High).await?;
    claimed.sort_by(|a, b| a.target_id.cmp(&b.target_id));

    let claimed_ids: Vec<&str> = claimed.iter().map(|t| t.target_id.as_str()).collect();
    assert_eq!(
        claimed_ids,
        vec!["error_stale", "ready_stale", "stuck_refreshing"]
    );
    // The returned prompt_hash comes from the definition.
    assert!(claimed.iter().all(|t| t.prompt_hash == "hash_v1"));

    // Claimed instances are now marked refreshing.
    for id in ["ready_stale", "error_stale", "stuck_refreshing"] {
        assert_eq!(
            status_of(&pool, "high/day", id).await?.as_deref(),
            Some("refreshing"),
            "{id} should be marked refreshing"
        );
    }
    // Skipped instances keep their status.
    assert_eq!(
        status_of(&pool, "high/day", "loading_stale")
            .await?
            .as_deref(),
        Some("loading")
    );
    assert_eq!(
        status_of(&pool, "high/day", "cold_stale").await?.as_deref(),
        Some("cold")
    );
    assert_eq!(
        status_of(&pool, "high/day", "ready_hot").await?.as_deref(),
        Some("ready")
    );
    assert_eq!(
        status_of(&pool, "high/day", "fresh_refreshing")
            .await?
            .as_deref(),
        Some("refreshing")
    );
    assert_eq!(
        status_of(&pool, "med/day", "other_cadence")
            .await?
            .as_deref(),
        Some("ready")
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expiry_window_scales_with_definition(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Same cadence, different expiry windows.
    insert_projection(&pool, "high/week", "high", "week").await?;

    let now = Utc::now();
    let stale = Some(now - Duration::hours(1));
    let generated = Some(now - Duration::days(2));

    // Requested 3 days ago: inactive under a `day` expiry, but still active under
    // a `week` expiry -> not deleted, and (being stale) eligible for refresh.
    insert_instance(
        &pool,
        "high/week",
        "three_days",
        "ready",
        generated,
        stale,
        now - Duration::days(3),
        now - Duration::days(3),
    )
    .await?;
    // Requested 10 days ago: inactive even under a `week` expiry -> deleted.
    insert_instance(
        &pool,
        "high/week",
        "ten_days",
        "ready",
        generated,
        stale,
        now - Duration::days(10),
        now - Duration::days(10),
    )
    .await?;

    let deleted = delete_inactive(&pool, RefreshCadence::High).await?;
    assert_eq!(deleted, 1);
    assert_eq!(status_of(&pool, "high/week", "ten_days").await?, None);

    let claimed = claim_stale(&pool, RefreshCadence::High).await?;
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].target_id, "three_days");

    Ok(())
}
