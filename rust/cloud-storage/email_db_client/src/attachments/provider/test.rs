use crate::attachments::provider::fetch_db_attachments;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_db_attachments"))
)]
async fn fetch_db_attachments_includes_sfs_mappings(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let message_id = Uuid::parse_str("00000000-0000-0000-0000-0000000e0501")?;
    let res = fetch_db_attachments(&pool, message_id).await?;

    // Verify SFS mappings are included/excluded correctly
    assert_eq!(res.len(), 4);

    // alpha_document.pdf has SFS mapping
    assert_eq!(res[0].filename, Some("alpha_document.pdf".to_string()));
    assert_eq!(
        res[0].sfs_id,
        Some(Uuid::parse_str("00000000-0000-0000-0000-000000f10001")?)
    );

    // bravo_image.jpg has SFS mapping
    assert_eq!(res[1].filename, Some("bravo_image.jpg".to_string()));
    assert_eq!(
        res[1].sfs_id,
        Some(Uuid::parse_str("00000000-0000-0000-0000-000000f10003")?)
    );

    // zulu_spreadsheet.xlsx does NOT have SFS mapping
    assert_eq!(res[2].filename, Some("zulu_spreadsheet.xlsx".to_string()));
    assert_eq!(res[2].sfs_id, None);

    // NULL filename does NOT have SFS mapping
    assert_eq!(res[3].filename, None);
    assert_eq!(res[3].sfs_id, None);

    Ok(())
}
