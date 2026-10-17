use crate::handler::{
    MAX_DELETE_DELAY_SECONDS, MAX_DELETES_PER_RUN, fetch_inactive_link_ids, fetch_unused_link_ids,
    plan_delete_batch,
};
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::email::service::pubsub::DeletionReason;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

fn link_ids(count: usize) -> Vec<Uuid> {
    (0..count).map(|_| Uuid::now_v7()).collect()
}

#[test]
fn plan_delete_batch_caps_links_per_run() {
    let planned = plan_delete_batch(link_ids(40), link_ids(40));

    assert_eq!(planned.len(), MAX_DELETES_PER_RUN);
}

#[test]
fn plan_delete_batch_staggers_delays_within_sqs_limit() {
    let planned = plan_delete_batch(link_ids(40), Vec::new());
    let delays: Vec<i32> = planned.iter().map(|p| p.delay_seconds).collect();

    assert_eq!(delays.first(), Some(&0));
    assert!(
        delays.windows(2).all(|pair| pair[0] < pair[1]),
        "each delete should be delivered after the previous one: {delays:?}"
    );
    assert!(
        delays
            .iter()
            .all(|d| (0..=MAX_DELETE_DELAY_SECONDS).contains(d))
    );
}

#[test]
fn plan_delete_batch_alternates_reasons_so_neither_starves() {
    let unused = link_ids(40);
    let inactive = link_ids(40);
    let planned = plan_delete_batch(unused.clone(), inactive.clone());

    let unused_planned = planned
        .iter()
        .filter(|p| matches!(p.deletion_reason, DeletionReason::Unused))
        .count();
    assert_eq!(unused_planned, MAX_DELETES_PER_RUN / 2);
    assert!(planned.iter().all(|p| match p.deletion_reason {
        DeletionReason::Unused => unused.contains(&p.link_id),
        DeletionReason::Inactive => inactive.contains(&p.link_id),
        _ => false,
    }));
}

#[test]
fn plan_delete_batch_fills_from_the_other_list_when_one_runs_out() {
    let unused = link_ids(2);
    let planned = plan_delete_batch(unused.clone(), link_ids(40));

    assert_eq!(planned.len(), MAX_DELETES_PER_RUN);
    let planned_unused: Vec<Uuid> = planned
        .iter()
        .filter(|p| matches!(p.deletion_reason, DeletionReason::Unused))
        .map(|p| p.link_id)
        .collect();
    assert_eq!(planned_unused, unused);
}

#[test]
fn plan_delete_batch_sends_everything_when_under_the_cap() {
    let planned = plan_delete_batch(link_ids(1), link_ids(2));

    assert_eq!(planned.len(), 3);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_returns_unused_links(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    // Link created 40 days ago with no history should be returned (threshold: 30 days)
    let result = fetch_unused_link_ids(&pool, 30).await?;

    let unused_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    assert!(
        result.contains(&unused_link_id),
        "Should include link with no history older than threshold"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_returns_stale_history_links(pool: Pool<Postgres>) -> Result<()> {
    // Link with history last updated 90 days ago should be returned (threshold: 60 days)
    let result = fetch_inactive_link_ids(&pool, 60).await?;

    let stale_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000002")?;
    assert!(
        result.contains(&stale_link_id),
        "Should include link with stale history"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_excludes_active_links(pool: Pool<Postgres>) -> Result<()> {
    let unused_result = fetch_unused_link_ids(&pool, 30).await?;
    let inactive_result = fetch_inactive_link_ids(&pool, 60).await?;

    // Link with recent history should NOT be returned
    let active_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000003")?;
    assert!(
        !unused_result.contains(&active_link_id) && !inactive_result.contains(&active_link_id),
        "Should not include link with recent history"
    );

    // Recently created link with no history should NOT be returned
    let new_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000004")?;
    assert!(
        !unused_result.contains(&new_link_id) && !inactive_result.contains(&new_link_id),
        "Should not include recently created link"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_excludes_macro_internal_links(pool: Pool<Postgres>) -> Result<()> {
    let unused_result = fetch_unused_link_ids(&pool, 30).await?;
    let inactive_result = fetch_inactive_link_ids(&pool, 60).await?;

    // Links with @macro.com in macro_id should never be deleted
    let internal_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000005")?;
    assert!(
        !unused_result.contains(&internal_link_id) && !inactive_result.contains(&internal_link_id),
        "Should not include internal @macro.com links"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("fetch_inactive_links"))
)]
async fn fetch_inactive_link_ids_respects_threshold_parameters(pool: Pool<Postgres>) -> Result<()> {
    // With very high thresholds, nothing should be returned
    let unused_result = fetch_unused_link_ids(&pool, 365).await?;
    let inactive_result = fetch_inactive_link_ids(&pool, 365).await?;
    assert!(
        unused_result.is_empty() && inactive_result.is_empty(),
        "High thresholds should return no links"
    );

    // With very low thresholds, more links should be returned
    let unused_result = fetch_unused_link_ids(&pool, 1).await?;
    let inactive_result = fetch_inactive_link_ids(&pool, 1).await?;
    assert!(
        !unused_result.is_empty() || !inactive_result.is_empty(),
        "Low thresholds should return some links"
    );

    Ok(())
}
