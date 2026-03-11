use crate::attachments::provider::fetch_db_attachments_in_bulk;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments_in_bulk"))
)]
async fn fetch_db_attachments_in_bulk_returns_attachments_grouped_by_message_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000a501")?;
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-00000000a502")?;

    let result = fetch_db_attachments_in_bulk(&pool, &[message_id_1, message_id_2]).await?;

    assert_eq!(result.len(), 2);

    // Message 1 should have 3 attachments
    let msg_1_attachments = result.get(&message_id_1).unwrap();
    assert_eq!(msg_1_attachments.len(), 3);

    // Message 2 should have 1 attachment
    let msg_2_attachments = result.get(&message_id_2).unwrap();
    assert_eq!(msg_2_attachments.len(), 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments_in_bulk"))
)]
async fn fetch_db_attachments_in_bulk_orders_by_message_id_and_filename_nulls_last(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000a501")?;

    let result = fetch_db_attachments_in_bulk(&pool, &[message_id_1]).await?;

    let msg_1_attachments = result.get(&message_id_1).unwrap();
    assert_eq!(msg_1_attachments.len(), 3);

    // Should be ordered by filename ASC
    assert_eq!(
        msg_1_attachments[0].filename,
        Some("alpha_document.pdf".to_string())
    );
    assert_eq!(
        msg_1_attachments[1].filename,
        Some("bravo_image.jpg".to_string())
    );
    assert_eq!(
        msg_1_attachments[2].filename,
        Some("zulu_spreadsheet.xlsx".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments_in_bulk"))
)]
async fn fetch_db_attachments_in_bulk_nulls_last_ordering(pool: Pool<Postgres>) -> Result<()> {
    let message_id_4 = Uuid::parse_str("00000000-0000-0000-0000-00000000a504")?;

    let result = fetch_db_attachments_in_bulk(&pool, &[message_id_4]).await?;

    let msg_4_attachments = result.get(&message_id_4).unwrap();
    assert_eq!(msg_4_attachments.len(), 2);

    // Named file should be first, NULL filename should be last
    assert_eq!(
        msg_4_attachments[0].filename,
        Some("alpha_first.pdf".to_string())
    );
    assert_eq!(msg_4_attachments[1].filename, None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments_in_bulk"))
)]
async fn fetch_db_attachments_in_bulk_includes_sfs_mappings(pool: Pool<Postgres>) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000a501")?;

    let result = fetch_db_attachments_in_bulk(&pool, &[message_id_1]).await?;

    let msg_1_attachments = result.get(&message_id_1).unwrap();

    // alpha_document.pdf has SFS mapping
    let alpha_att = msg_1_attachments
        .iter()
        .find(|a| a.filename == Some("alpha_document.pdf".to_string()))
        .unwrap();
    assert_eq!(
        alpha_att.sfs_id,
        Some(Uuid::parse_str("00000000-0000-0000-0000-000000f1a001")?)
    );

    // bravo_image.jpg does NOT have SFS mapping
    let bravo_att = msg_1_attachments
        .iter()
        .find(|a| a.filename == Some("bravo_image.jpg".to_string()))
        .unwrap();
    assert_eq!(bravo_att.sfs_id, None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments_in_bulk"))
)]
async fn fetch_db_attachments_in_bulk_returns_correct_fields(pool: Pool<Postgres>) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000a501")?;

    let result = fetch_db_attachments_in_bulk(&pool, &[message_id_1]).await?;

    let msg_1_attachments = result.get(&message_id_1).unwrap();
    let alpha_att = msg_1_attachments
        .iter()
        .find(|a| a.filename == Some("alpha_document.pdf".to_string()))
        .unwrap();

    assert_eq!(
        alpha_att.id,
        Uuid::parse_str("00000000-0000-0000-0000-0000001aa001")?
    );
    assert_eq!(alpha_att.message_id, message_id_1);
    assert_eq!(
        alpha_att.provider_attachment_id,
        Some("provider-att-a001".to_string())
    );
    assert_eq!(alpha_att.mime_type, Some("application/pdf".to_string()));
    assert_eq!(alpha_att.size_bytes, Some(102400));
    assert_eq!(alpha_att.content_id, None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments_in_bulk"))
)]
async fn fetch_db_attachments_in_bulk_excludes_messages_without_attachments(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_with_attachments = Uuid::parse_str("00000000-0000-0000-0000-00000000a501")?;
    let message_id_without_attachments = Uuid::parse_str("00000000-0000-0000-0000-00000000a503")?;

    let result = fetch_db_attachments_in_bulk(
        &pool,
        &[message_id_with_attachments, message_id_without_attachments],
    )
    .await?;

    // Only message with attachments should be in the map
    assert_eq!(result.len(), 1);
    assert!(result.contains_key(&message_id_with_attachments));
    assert!(!result.contains_key(&message_id_without_attachments));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments_in_bulk"))
)]
async fn fetch_db_attachments_in_bulk_returns_empty_for_empty_input(
    pool: Pool<Postgres>,
) -> Result<()> {
    let result = fetch_db_attachments_in_bulk(&pool, &[]).await?;

    assert!(result.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments_in_bulk"))
)]
async fn fetch_db_attachments_in_bulk_returns_empty_for_nonexistent_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let nonexistent_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000ffff")?;

    let result = fetch_db_attachments_in_bulk(&pool, &[nonexistent_message_id]).await?;

    assert!(result.is_empty());

    Ok(())
}
