use crate::attachments::forwarded::{
    delete_forwarded_attachment, fetch_forwarded_attachments_by_draft_id,
    fetch_forwarded_attachments_in_bulk, insert_forwarded_attachment,
};
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn fetch_forwarded_attachments_returns_attachments_ordered_by_filename(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;

    let res = fetch_forwarded_attachments_by_draft_id(&pool, link_id, draft_id).await?;

    assert_eq!(res.len(), 2);

    // Verify ordering by filename ASC
    assert_eq!(res[0].filename, Some("photo.jpg".to_string()));
    assert_eq!(res[1].filename, Some("report.pdf".to_string()));

    // Verify other fields
    assert_eq!(res[0].mime_type, Some("image/jpeg".to_string()));
    assert_eq!(res[0].size_bytes, Some(120000));
    assert_eq!(
        res[0].provider_attachment_id,
        Some("gmail-att-id-002".to_string())
    );
    assert_eq!(res[0].message_provider_id, "gmail-original-msg-001");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn fetch_forwarded_attachments_returns_empty_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;

    let res = fetch_forwarded_attachments_by_draft_id(&pool, wrong_link_id, draft_id).await?;

    assert_eq!(res.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn insert_forwarded_attachment_creates_new_link(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f502")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000fa001")?;

    // Verify no forwarded attachments before insert
    let before = fetch_forwarded_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(before.len(), 0);

    insert_forwarded_attachment(&pool, link_id, draft_id, attachment_id).await?;

    // Verify attachment was linked
    let after = fetch_forwarded_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].attachment_id, attachment_id);
    assert_eq!(after[0].filename, Some("report.pdf".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn insert_forwarded_attachment_is_idempotent(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;
    // This attachment is already linked to this draft in the fixture
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000fa001")?;

    // Should not error on duplicate
    insert_forwarded_attachment(&pool, link_id, draft_id, attachment_id).await?;

    let res = fetch_forwarded_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(res.len(), 2); // Still 2, not 3

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn insert_forwarded_attachment_does_nothing_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f502")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000fa001")?;

    insert_forwarded_attachment(&pool, wrong_link_id, draft_id, attachment_id).await?;

    // Verify nothing was inserted with the correct link_id
    let correct_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let attachments =
        fetch_forwarded_attachments_by_draft_id(&pool, correct_link_id, draft_id).await?;
    assert_eq!(attachments.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn delete_forwarded_attachment_removes_link(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f503")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000fa003")?;

    // Verify attachment exists before delete
    let before = fetch_forwarded_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(before.len(), 1);

    let rows_affected =
        delete_forwarded_attachment(&pool, link_id, draft_id, attachment_id).await?;

    assert_eq!(rows_affected, 1);

    // Verify attachment is deleted
    let after = fetch_forwarded_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(after.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn delete_forwarded_attachment_returns_zero_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f503")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000fa003")?;

    let rows_affected =
        delete_forwarded_attachment(&pool, wrong_link_id, draft_id, attachment_id).await?;

    assert_eq!(rows_affected, 0);

    // Verify attachment still exists with correct link_id
    let correct_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let attachments =
        fetch_forwarded_attachments_by_draft_id(&pool, correct_link_id, draft_id).await?;
    assert_eq!(attachments.len(), 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn delete_forwarded_attachment_returns_zero_for_nonexistent(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000f01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f503")?;
    let nonexistent_id = Uuid::parse_str("00000000-0000-0000-0000-0000000fffff")?;

    let rows_affected =
        delete_forwarded_attachment(&pool, link_id, draft_id, nonexistent_id).await?;

    assert_eq!(rows_affected, 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn fetch_forwarded_attachments_in_bulk_returns_grouped_by_draft_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let draft_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;
    let draft_id_3 = Uuid::parse_str("00000000-0000-0000-0000-00000000f503")?;

    let result = fetch_forwarded_attachments_in_bulk(&pool, &[draft_id_1, draft_id_3]).await?;

    assert_eq!(result.len(), 2);

    // Draft 1 should have 2 forwarded attachments
    let draft_1_attachments = result.get(&draft_id_1).unwrap();
    assert_eq!(draft_1_attachments.len(), 2);

    // Draft 3 should have 1 forwarded attachment
    let draft_3_attachments = result.get(&draft_id_3).unwrap();
    assert_eq!(draft_3_attachments.len(), 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn fetch_forwarded_attachments_in_bulk_returns_empty_for_empty_input(
    pool: Pool<Postgres>,
) -> Result<()> {
    let result = fetch_forwarded_attachments_in_bulk(&pool, &[]).await?;

    assert!(result.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("forwarded_attachments"))
)]
async fn fetch_forwarded_attachments_in_bulk_excludes_drafts_without_attachments(
    pool: Pool<Postgres>,
) -> Result<()> {
    let draft_with = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;
    let draft_without = Uuid::parse_str("00000000-0000-0000-0000-00000000f502")?;

    let result = fetch_forwarded_attachments_in_bulk(&pool, &[draft_with, draft_without]).await?;

    assert_eq!(result.len(), 1);
    assert!(result.contains_key(&draft_with));
    assert!(!result.contains_key(&draft_without));

    Ok(())
}
