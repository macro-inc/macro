use super::*;

// Only the denormalized owner column is relaxed. Full document creation still
// writes user-specific relations (such as history) that require a real user.
#[sqlx::test]
async fn document_row_does_not_require_a_user_owner(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    let owner = MacroUserIdStr::parse_from_str("macro|non-existent-user@fake.com")?;
    let now = chrono::Utc::now();

    let document = insert_document_no_id(
        &mut transaction,
        owner.copied(),
        "document-name",
        Some(FileType::Pdf),
        None,
        &now,
    )
    .await?;
    assert!(!document.id.is_empty());

    insert_document_with_id(
        &mut transaction,
        &macro_uuid::generate_uuid_v7().to_string(),
        owner,
        "document-with-id",
        Some(FileType::Pdf),
        None,
        &now,
    )
    .await?;

    transaction.rollback().await?;
    Ok(())
}
