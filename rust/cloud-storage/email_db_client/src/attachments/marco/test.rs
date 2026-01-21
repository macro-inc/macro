use crate::attachments::marco::fetch_db_macro_attachments_in_bulk;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_db_macro_attachments_in_bulk")
    )
)]
async fn fetch_db_macro_attachments_in_bulk_returns_attachments_grouped_by_message_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000c501")?;
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-00000000c502")?;

    let result = fetch_db_macro_attachments_in_bulk(&pool, &[message_id_1, message_id_2]).await?;

    assert_eq!(result.len(), 2);

    // Message 1 should have 2 attachments
    let msg_1_attachments = result.get(&message_id_1).unwrap();
    assert_eq!(msg_1_attachments.len(), 2);

    // Message 2 should have 1 attachment
    let msg_2_attachments = result.get(&message_id_2).unwrap();
    assert_eq!(msg_2_attachments.len(), 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_db_macro_attachments_in_bulk")
    )
)]
async fn fetch_db_macro_attachments_in_bulk_orders_by_message_id_and_id_desc(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000c501")?;

    let result = fetch_db_macro_attachments_in_bulk(&pool, &[message_id_1]).await?;

    let msg_1_attachments = result.get(&message_id_1).unwrap();
    assert_eq!(msg_1_attachments.len(), 2);

    // Should be ordered by id DESC (attachment 2 before attachment 1)
    assert_eq!(
        msg_1_attachments[0].id,
        Uuid::parse_str("00000000-0000-0000-0000-0000000ca002")?
    );
    assert_eq!(
        msg_1_attachments[1].id,
        Uuid::parse_str("00000000-0000-0000-0000-0000000ca001")?
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_db_macro_attachments_in_bulk")
    )
)]
async fn fetch_db_macro_attachments_in_bulk_returns_correct_fields(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-00000000c501")?;

    let result = fetch_db_macro_attachments_in_bulk(&pool, &[message_id_1]).await?;

    let msg_1_attachments = result.get(&message_id_1).unwrap();
    // Find the document attachment (id ca001)
    let document_att = msg_1_attachments
        .iter()
        .find(|a| a.id == Uuid::parse_str("00000000-0000-0000-0000-0000000ca001").unwrap())
        .unwrap();

    assert_eq!(document_att.message_id, message_id_1);
    assert_eq!(
        document_att.item_id,
        Uuid::parse_str("00000000-0000-0000-0000-000000001001")?
    );
    assert_eq!(document_att.item_type, "document");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_db_macro_attachments_in_bulk")
    )
)]
async fn fetch_db_macro_attachments_in_bulk_excludes_messages_without_attachments(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_with_attachments = Uuid::parse_str("00000000-0000-0000-0000-00000000c501")?;
    let message_id_without_attachments = Uuid::parse_str("00000000-0000-0000-0000-00000000c503")?;

    let result = fetch_db_macro_attachments_in_bulk(
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
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_db_macro_attachments_in_bulk")
    )
)]
async fn fetch_db_macro_attachments_in_bulk_returns_empty_for_empty_input(
    pool: Pool<Postgres>,
) -> Result<()> {
    let result = fetch_db_macro_attachments_in_bulk(&pool, &[]).await?;

    assert!(result.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("fetch_db_macro_attachments_in_bulk")
    )
)]
async fn fetch_db_macro_attachments_in_bulk_returns_empty_for_nonexistent_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let nonexistent_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000ffff")?;

    let result = fetch_db_macro_attachments_in_bulk(&pool, &[nonexistent_message_id]).await?;

    assert!(result.is_empty());

    Ok(())
}
