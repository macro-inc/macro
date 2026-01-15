use crate::messages::get::draft_exists_with_id;
use crate::messages::scheduled::get::get_scheduled_db_messages_by_link_id;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_true_for_existing_draft(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    let exists = draft_exists_with_id(&pool, link_id, draft_id).await?;

    assert!(exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_non_draft_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let non_draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e502")?;

    let exists = draft_exists_with_id(&pool, link_id, non_draft_id).await?;

    assert!(!exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000e501")?;

    let exists = draft_exists_with_id(&pool, wrong_link_id, draft_id).await?;

    assert!(!exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("draft_exists_with_id"))
)]
async fn draft_exists_with_id_returns_false_for_nonexistent_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000e01")?;
    let nonexistent_id = Uuid::parse_str("00000000-0000-0000-0000-00000000efff")?;

    let exists = draft_exists_with_id(&pool, link_id, nonexistent_id).await?;

    assert!(!exists);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_returns_unsent_only(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    // Should return 3 unsent scheduled messages
    assert_eq!(result.len(), 3);

    // Verify all returned messages are unsent scheduled messages
    let returned_ids: Vec<Uuid> = result.iter().map(|m| m.id).collect();

    let unsent_1 = Uuid::parse_str("00000000-0000-0000-0000-0000000d0001")?;
    let unsent_2 = Uuid::parse_str("00000000-0000-0000-0000-0000000d0002")?;
    let unsent_3 = Uuid::parse_str("00000000-0000-0000-0000-0000000d0003")?;

    assert!(
        returned_ids.contains(&unsent_1),
        "Should include unsent message 1"
    );
    assert!(
        returned_ids.contains(&unsent_2),
        "Should include unsent message 2"
    );
    assert!(
        returned_ids.contains(&unsent_3),
        "Should include unsent message 3"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_excludes_sent_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    let returned_ids: Vec<Uuid> = result.iter().map(|m| m.id).collect();

    // Already sent scheduled message should NOT be included
    let sent_msg = Uuid::parse_str("00000000-0000-0000-0000-0000000d0004")?;
    assert!(
        !returned_ids.contains(&sent_msg),
        "Should not include already sent message"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_excludes_non_scheduled_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    let returned_ids: Vec<Uuid> = result.iter().map(|m| m.id).collect();

    // Regular non-scheduled message should NOT be included
    let regular_msg = Uuid::parse_str("00000000-0000-0000-0000-0000000d0005")?;
    assert!(
        !returned_ids.contains(&regular_msg),
        "Should not include non-scheduled message"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_isolates_by_link_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    let returned_ids: Vec<Uuid> = result.iter().map(|m| m.id).collect();

    // Message from other link should NOT be included
    let other_link_msg = Uuid::parse_str("00000000-0000-0000-0000-0000000d0006")?;
    assert!(
        !returned_ids.contains(&other_link_msg),
        "Should not include messages from other links"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_orders_by_created_at_desc(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 100).await?;

    // Should be ordered by created_at DESC (newest first)
    assert_eq!(
        result[0].subject,
        Some("Newest scheduled message".to_string())
    );
    assert_eq!(
        result[1].subject,
        Some("Middle scheduled message".to_string())
    );
    assert_eq!(
        result[2].subject,
        Some("Oldest scheduled message".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_respects_limit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Request only 2 messages
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 2).await?;

    assert_eq!(result.len(), 2);

    // Should return the 2 newest (ordered by created_at DESC)
    assert_eq!(
        result[0].subject,
        Some("Newest scheduled message".to_string())
    );
    assert_eq!(
        result[1].subject,
        Some("Middle scheduled message".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_respects_offset(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Skip first 2 messages
    let result = get_scheduled_db_messages_by_link_id(&pool, link_id, 2, 100).await?;

    assert_eq!(result.len(), 1);

    // Should return only the oldest message
    assert_eq!(
        result[0].subject,
        Some("Oldest scheduled message".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_pagination_works(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Page 1: limit 1, offset 0
    let page1 = get_scheduled_db_messages_by_link_id(&pool, link_id, 0, 1).await?;
    assert_eq!(page1.len(), 1);
    assert_eq!(
        page1[0].subject,
        Some("Newest scheduled message".to_string())
    );

    // Page 2: limit 1, offset 1
    let page2 = get_scheduled_db_messages_by_link_id(&pool, link_id, 1, 1).await?;
    assert_eq!(page2.len(), 1);
    assert_eq!(
        page2[0].subject,
        Some("Middle scheduled message".to_string())
    );

    // Page 3: limit 1, offset 2
    let page3 = get_scheduled_db_messages_by_link_id(&pool, link_id, 2, 1).await?;
    assert_eq!(page3.len(), 1);
    assert_eq!(
        page3[0].subject,
        Some("Oldest scheduled message".to_string())
    );

    // Page 4: limit 1, offset 3 (no more results)
    let page4 = get_scheduled_db_messages_by_link_id(&pool, link_id, 3, 1).await?;
    assert!(page4.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("get_scheduled_db_messages"))
)]
async fn get_scheduled_db_messages_returns_empty_for_nonexistent_link(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let nonexistent_link_id = Uuid::parse_str("00000000-0000-0000-0000-999999999999")?;
    let result = get_scheduled_db_messages_by_link_id(&pool, nonexistent_link_id, 0, 100).await?;

    assert!(result.is_empty());

    Ok(())
}
