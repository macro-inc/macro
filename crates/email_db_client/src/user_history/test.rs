use super::*;
use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_all_non_drafts_with_sent_at(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000301")?;

    let result = get_thread_summary_info(&pool, &[link_id], &[thread_id]).await?;

    assert_eq!(result.len(), 1);
    let info = result.get(&thread_id).unwrap();

    // Should use MIN(sent_at) and MAX(sent_at) from non-drafts
    let expected_first =
        DateTime::parse_from_rfc3339("2025-01-10T10:00:00+00:00")?.with_timezone(&Utc);
    let expected_last =
        DateTime::parse_from_rfc3339("2025-01-10T12:00:00+00:00")?.with_timezone(&Utc);

    assert_eq!(info.created_at, expected_first);
    assert_eq!(info.updated_at, expected_last);
    assert_eq!(info.subject, Some("Test Subject 1".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_all_drafts_fallback_to_updated_at(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000302")?;

    let result = get_thread_summary_info(&pool, &[link_id], &[thread_id]).await?;

    assert_eq!(result.len(), 1);
    let info = result.get(&thread_id).unwrap();

    // Should fallback to MIN(updated_at) and MAX(updated_at) since all are drafts
    let expected_first =
        DateTime::parse_from_rfc3339("2025-01-11T09:15:00+00:00")?.with_timezone(&Utc);
    let expected_last =
        DateTime::parse_from_rfc3339("2025-01-11T10:45:00+00:00")?.with_timezone(&Utc);

    assert_eq!(info.created_at, expected_first);
    assert_eq!(info.updated_at, expected_last);
    assert_eq!(info.subject, Some("Draft Subject".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_mixed_drafts_ignores_draft_timestamps(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000303")?;

    let result = get_thread_summary_info(&pool, &[link_id], &[thread_id]).await?;

    assert_eq!(result.len(), 1);
    let info = result.get(&thread_id).unwrap();

    // Should use sent_at from non-drafts only, ignoring drafts
    // Draft at 07:30 (earliest updated_at) should be ignored
    // Non-draft at 10:00 should be first_message_ts
    // Draft at 14:30 (latest updated_at) should be ignored
    // Non-draft at 12:00 should be last_message_ts
    let expected_first =
        DateTime::parse_from_rfc3339("2025-01-12T10:00:00+00:00")?.with_timezone(&Utc);
    let expected_last =
        DateTime::parse_from_rfc3339("2025-01-12T12:00:00+00:00")?.with_timezone(&Utc);

    assert_eq!(info.created_at, expected_first);
    assert_eq!(info.updated_at, expected_last);
    assert_eq!(info.subject, Some("Mixed Subject".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_single_message_same_first_and_last(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000305")?;

    let result = get_thread_summary_info(&pool, &[link_id], &[thread_id]).await?;

    assert_eq!(result.len(), 1);
    let info = result.get(&thread_id).unwrap();

    // Single message: first and last timestamps should be the same
    let expected_ts =
        DateTime::parse_from_rfc3339("2025-01-14T10:00:00+00:00")?.with_timezone(&Utc);

    assert_eq!(info.created_at, expected_ts);
    assert_eq!(info.updated_at, expected_ts);
    assert_eq!(info.subject, Some("Single Subject".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_partial_sent_at_prefers_sent_at_over_updated_at(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000306")?;

    let result = get_thread_summary_info(&pool, &[link_id], &[thread_id]).await?;

    assert_eq!(result.len(), 1);
    let info = result.get(&thread_id).unwrap();

    // When some non-drafts have sent_at and some don't:
    // - FILTER (WHERE is_draft = false) returns only non-drafts
    // - MIN/MAX of sent_at ignores NULLs, so only considers messages with sent_at
    // - First message with sent_at: 10:00
    // - Last message with sent_at: 12:00
    // Messages without sent_at (07:20 and 14:30) should be ignored
    let expected_first =
        DateTime::parse_from_rfc3339("2025-01-15T10:00:00+00:00")?.with_timezone(&Utc);
    let expected_last =
        DateTime::parse_from_rfc3339("2025-01-15T12:00:00+00:00")?.with_timezone(&Utc);

    assert_eq!(info.created_at, expected_first);
    assert_eq!(info.updated_at, expected_last);
    assert_eq!(info.subject, Some("Partial Sent Subject".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_multiple_threads(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_ids = vec![
        Uuid::parse_str("00000000-0000-0000-0000-000000000301")?,
        Uuid::parse_str("00000000-0000-0000-0000-000000000302")?,
        Uuid::parse_str("00000000-0000-0000-0000-000000000305")?,
    ];

    let result = get_thread_summary_info(&pool, &[link_id], &thread_ids).await?;

    // Should return info for all 3 threads
    assert_eq!(result.len(), 3);
    assert!(result.contains_key(&thread_ids[0]));
    assert!(result.contains_key(&thread_ids[1]));
    assert!(result.contains_key(&thread_ids[2]));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_empty_thread_ids_returns_empty(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_ids: Vec<Uuid> = vec![];

    let result = get_thread_summary_info(&pool, &[link_id], &thread_ids).await?;

    assert_eq!(result.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_viewed_at_logic(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000301")?;

    let result = get_thread_summary_info(&pool, &[link_id], &[thread_id]).await?;

    assert_eq!(result.len(), 1);
    let info = result.get(&thread_id).unwrap();

    // viewed_at (13:00) is after last_message_ts (12:00), so should be included
    let expected_viewed =
        DateTime::parse_from_rfc3339("2025-01-10T13:00:00+00:00")?.with_timezone(&Utc);
    assert_eq!(info.viewed_at, Some(expected_viewed));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_subject_is_from_earliest_message(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000307")?;

    let result = get_thread_summary_info(&pool, &[link_id], &[thread_id]).await?;

    assert_eq!(result.len(), 1);
    let info = result.get(&thread_id).unwrap();

    // The thread has two messages:
    // 1. Earliest: Subject "Original Subject"
    // 2. Latest: Subject "Reply Subject"
    // We want the subject of the earliest message.
    assert_eq!(info.subject, Some("Original Subject".to_string()));

    // Verify we are still getting snippet/sender from the LATEST message
    assert_eq!(info.snippet, Some("Reply message".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_thread_summary_info"))
)]
async fn get_thread_summary_info_filter_out_trash(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001c")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000000308")?;

    let result = get_thread_summary_info(&pool, &[link_id], &[thread_id]).await?;

    assert!(result.is_empty());

    Ok(())
}
