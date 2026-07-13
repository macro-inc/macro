use crate::contacts::get::{
    fetch_contacts_by_link_id, fetch_db_recipients_in_bulk, fetch_senders_by_message_ids,
};
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::db::address::EmailRecipientType;
use models_email::email::service::address::ContactInfoWithInteraction;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};
use std::collections::HashMap;

/// Mirrors the `/email/contacts` handler: union the caller's owned inboxes and
/// group each inbox's contacts by link id. A two-inbox user must see both
/// inboxes' contacts under their own link ids.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_two_links"))
)]
async fn fetch_contacts_unions_across_links_for_one_user(pool: Pool<Postgres>) -> Result<()> {
    let links = crate::links::get::fetch_links_by_fusionauth_user_id(&pool, "fa-multi").await?;
    assert_eq!(links.len(), 2, "user owns two inboxes");

    let mut contacts: HashMap<Uuid, Vec<ContactInfoWithInteraction>> = HashMap::new();
    for link in &links {
        contacts.insert(link.id, fetch_contacts_by_link_id(&pool, link.id).await?);
    }

    let link1 = Uuid::parse_str("d1000000-0000-0000-0000-000000000001")?;
    let link2 = Uuid::parse_str("d2000000-0000-0000-0000-000000000002")?;

    assert_eq!(contacts[&link1].len(), 1);
    assert_eq!(contacts[&link1][0].extra.email_address, "alice@example.com");
    assert_eq!(contacts[&link2].len(), 1);
    assert_eq!(contacts[&link2][0].extra.email_address, "bob@example.com");

    Ok(())
}

// ============================================================================
// Tests for fetch_senders_by_message_ids
// ============================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_senders_by_message_ids_returns_senders_grouped_by_message_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000006501")?;
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-000000006502")?;

    let result = fetch_senders_by_message_ids(&pool, &[message_id_1, message_id_2]).await?;

    assert_eq!(result.len(), 2);
    assert!(result.contains_key(&message_id_1));
    assert!(result.contains_key(&message_id_2));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_senders_by_message_ids_returns_correct_contact_data(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000006501")?;

    let result = fetch_senders_by_message_ids(&pool, &[message_id_1]).await?;

    let sender = result.get(&message_id_1).unwrap();
    assert_eq!(
        sender.id,
        Uuid::parse_str("00000000-0000-0000-0000-0000000c6001")?
    );
    assert_eq!(sender.email_address, Some("alice@example.com".to_string()));
    // from_name overrides contact name
    assert_eq!(sender.name, Some("Alice Custom Name".to_string()));
    assert_eq!(
        sender.original_photo_url,
        Some("https://photos.example.com/alice.jpg".to_string())
    );
    assert_eq!(
        sender.sfs_photo_url,
        Some("https://sfs.example.com/alice.jpg".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_senders_by_message_ids_uses_contact_name_when_no_from_name(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-000000006502")?;

    let result = fetch_senders_by_message_ids(&pool, &[message_id_2]).await?;

    let sender = result.get(&message_id_2).unwrap();
    // No from_name on message, so contact name is used
    assert_eq!(sender.name, Some("Bob Sender".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_senders_by_message_ids_excludes_messages_without_from_contact(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_with_sender = Uuid::parse_str("00000000-0000-0000-0000-000000006501")?;
    let message_without_sender = Uuid::parse_str("00000000-0000-0000-0000-000000006503")?;

    let result =
        fetch_senders_by_message_ids(&pool, &[message_with_sender, message_without_sender]).await?;

    assert_eq!(result.len(), 1);
    assert!(result.contains_key(&message_with_sender));
    assert!(!result.contains_key(&message_without_sender));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_senders_by_message_ids_returns_empty_for_empty_input(
    pool: Pool<Postgres>,
) -> Result<()> {
    let result = fetch_senders_by_message_ids(&pool, &[]).await?;

    assert!(result.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_senders_by_message_ids_returns_empty_for_nonexistent_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let nonexistent_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000ffff")?;

    let result = fetch_senders_by_message_ids(&pool, &[nonexistent_message_id]).await?;

    assert!(result.is_empty());

    Ok(())
}

// ============================================================================
// Tests for fetch_db_recipients_in_bulk
// ============================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_db_recipients_in_bulk_returns_recipients_grouped_by_message_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000006501")?;
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-000000006502")?;

    let result = fetch_db_recipients_in_bulk(&pool, &[message_id_1, message_id_2]).await?;

    assert_eq!(result.len(), 2);

    // Message 1 should have 2 recipients (TO and CC)
    let msg_1_recipients = result.get(&message_id_1).unwrap();
    assert_eq!(msg_1_recipients.len(), 2);

    // Message 2 should have 3 recipients (TO, CC, BCC)
    let msg_2_recipients = result.get(&message_id_2).unwrap();
    assert_eq!(msg_2_recipients.len(), 3);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_db_recipients_in_bulk_returns_correct_contact_data(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000006501")?;

    let result = fetch_db_recipients_in_bulk(&pool, &[message_id_1]).await?;

    let msg_1_recipients = result.get(&message_id_1).unwrap();

    // Find TO recipient (Charlie)
    let to_recipient = msg_1_recipients
        .iter()
        .find(|(_, rt)| *rt == EmailRecipientType::To)
        .unwrap();

    assert_eq!(
        to_recipient.0.id,
        Uuid::parse_str("00000000-0000-0000-0000-0000000c6003")?
    );
    assert_eq!(
        to_recipient.0.email_address,
        Some("charlie@example.com".to_string())
    );
    assert_eq!(to_recipient.0.name, Some("Charlie Recipient".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_db_recipients_in_bulk_excludes_messages_without_recipients(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_with_recipients = Uuid::parse_str("00000000-0000-0000-0000-000000006501")?;
    let message_without_recipients = Uuid::parse_str("00000000-0000-0000-0000-000000006504")?;

    let result = fetch_db_recipients_in_bulk(
        &pool,
        &[message_with_recipients, message_without_recipients],
    )
    .await?;

    assert_eq!(result.len(), 1);
    assert!(result.contains_key(&message_with_recipients));
    assert!(!result.contains_key(&message_without_recipients));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_db_recipients_in_bulk_returns_empty_for_empty_input(
    pool: Pool<Postgres>,
) -> Result<()> {
    let result = fetch_db_recipients_in_bulk(&pool, &[]).await?;

    assert!(result.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_contacts_in_bulk"))
)]
async fn fetch_db_recipients_in_bulk_returns_empty_for_nonexistent_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let nonexistent_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000ffff")?;

    let result = fetch_db_recipients_in_bulk(&pool, &[nonexistent_message_id]).await?;

    assert!(result.is_empty());

    Ok(())
}
