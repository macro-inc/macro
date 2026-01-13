use crate::attachments::draft::{
    delete_draft_attachment, fetch_db_draft_attachments, fetch_draft_attachments_by_draft_id,
    get_total_attachments_size_by_draft_id, insert_draft_attachment,
};
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn fetch_draft_attachments_returns_attachments_ordered_by_filename(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d501")?;

    let res = fetch_draft_attachments_by_draft_id(&pool, link_id, draft_id).await?;

    assert_eq!(res.len(), 3);

    // Verify ordering by filename ASC
    assert_eq!(res[0].file_name, "alpha_file.pdf");
    assert_eq!(res[1].file_name, "bravo_image.png");
    assert_eq!(res[2].file_name, "zulu_doc.docx");

    // Verify other fields
    assert_eq!(res[0].content_type, "application/pdf");
    assert_eq!(res[0].size, 1000);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn fetch_draft_attachments_returns_empty_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d501")?;

    let res = fetch_draft_attachments_by_draft_id(&pool, wrong_link_id, draft_id).await?;

    assert_eq!(res.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn get_total_attachments_size_returns_correct_sum(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d501")?;

    let total_size = get_total_attachments_size_by_draft_id(&pool, link_id, draft_id).await?;

    // 1000 + 2000 + 3000 = 6000
    assert_eq!(total_size, 6000);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn get_total_attachments_size_returns_zero_for_empty_draft(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d502")?;

    let total_size = get_total_attachments_size_by_draft_id(&pool, link_id, draft_id).await?;

    assert_eq!(total_size, 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn get_total_attachments_size_returns_zero_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d501")?;

    let total_size = get_total_attachments_size_by_draft_id(&pool, wrong_link_id, draft_id).await?;

    assert_eq!(total_size, 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn delete_draft_attachment_removes_attachment(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d503")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000da004")?;

    // Verify attachment exists before delete
    let before = fetch_draft_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(before.len(), 1);

    let rows_affected = delete_draft_attachment(&pool, link_id, draft_id, attachment_id).await?;

    assert_eq!(rows_affected, 1);

    // Verify attachment is deleted
    let after = fetch_draft_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(after.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn delete_draft_attachment_returns_zero_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d503")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000da004")?;

    let rows_affected =
        delete_draft_attachment(&pool, wrong_link_id, draft_id, attachment_id).await?;

    assert_eq!(rows_affected, 0);

    // Verify attachment still exists with correct link_id
    let correct_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let attachments = fetch_draft_attachments_by_draft_id(&pool, correct_link_id, draft_id).await?;
    assert_eq!(attachments.len(), 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn delete_draft_attachment_returns_zero_for_nonexistent_attachment(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d503")?;
    let nonexistent_id = Uuid::parse_str("00000000-0000-0000-0000-0000000dffff")?;

    let rows_affected = delete_draft_attachment(&pool, link_id, draft_id, nonexistent_id).await?;

    assert_eq!(rows_affected, 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn insert_draft_attachment_creates_new_attachment(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d502")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000da099")?;

    let attachment = service::attachment::AttachmentDraft {
        id: attachment_id,
        draft_id,
        file_name: "new_attachment.pdf".to_string(),
        content_type: "application/pdf".to_string(),
        sha: "sha256_new".to_string(),
        size: 5000,
        s3_key: "s3://bucket/new_attachment.pdf".to_string(),
    };

    // Verify no attachments before insert
    let before = fetch_draft_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(before.len(), 0);

    insert_draft_attachment(&pool, link_id, attachment).await?;

    // Verify attachment was created
    let after = fetch_draft_attachments_by_draft_id(&pool, link_id, draft_id).await?;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].file_name, "new_attachment.pdf");
    assert_eq!(after[0].size, 5000);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("draft_attachments"))
)]
async fn insert_draft_attachment_does_nothing_for_wrong_link_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let wrong_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d02")?;
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d502")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000000da098")?;

    let attachment = service::attachment::AttachmentDraft {
        id: attachment_id,
        draft_id,
        file_name: "should_not_insert.pdf".to_string(),
        content_type: "application/pdf".to_string(),
        sha: "sha256_no_insert".to_string(),
        size: 1234,
        s3_key: "s3://bucket/should_not_insert.pdf".to_string(),
    };

    // Insert with wrong link_id (should not insert anything)
    insert_draft_attachment(&pool, wrong_link_id, attachment).await?;

    // Verify nothing was inserted (check with correct link_id)
    let correct_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?;
    let attachments = fetch_draft_attachments_by_draft_id(&pool, correct_link_id, draft_id).await?;
    assert_eq!(attachments.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_draft_attachments"))
)]
async fn fetch_db_draft_attachments_returns_attachments_ordered_by_filename(
    pool: Pool<Postgres>,
) -> Result<()> {
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;

    let res = fetch_db_draft_attachments(&pool, draft_id).await?;

    assert_eq!(res.len(), 3);

    // Verify ordering by file_name ASC
    assert_eq!(res[0].file_name, "alpha_doc.pdf");
    assert_eq!(res[1].file_name, "mike_image.png");
    assert_eq!(res[2].file_name, "zulu_file.txt");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_draft_attachments"))
)]
async fn fetch_db_draft_attachments_returns_correct_fields(pool: Pool<Postgres>) -> Result<()> {
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f501")?;

    let res = fetch_db_draft_attachments(&pool, draft_id).await?;

    // Verify first attachment (alpha_doc.pdf) has correct fields
    let first = &res[0];
    assert_eq!(
        first.id,
        Uuid::parse_str("00000000-0000-0000-0000-0000000fa002")?
    );
    assert_eq!(first.draft_id, draft_id);
    assert_eq!(first.file_name, "alpha_doc.pdf");
    assert_eq!(first.content_type, "application/pdf");
    assert_eq!(first.sha, "sha256_alpha");
    assert_eq!(first.size, 2500);
    assert_eq!(first.s3_key, "s3://bucket/draft/f501/fa002");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_draft_attachments"))
)]
async fn fetch_db_draft_attachments_returns_empty_for_draft_without_attachments(
    pool: Pool<Postgres>,
) -> Result<()> {
    let draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000f502")?;

    let res = fetch_db_draft_attachments(&pool, draft_id).await?;

    assert_eq!(res.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_draft_attachments"))
)]
async fn fetch_db_draft_attachments_returns_empty_for_nonexistent_draft(
    pool: Pool<Postgres>,
) -> Result<()> {
    let nonexistent_draft_id = Uuid::parse_str("00000000-0000-0000-0000-00000000ffff")?;

    let res = fetch_db_draft_attachments(&pool, nonexistent_draft_id).await?;

    assert_eq!(res.len(), 0);

    Ok(())
}
