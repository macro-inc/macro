use super::*;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const LINK_ID: &str = "00000000-0000-0000-0000-000000000801";
const ALICE_CONTACT_ID: &str = "00000000-0000-0000-0000-0000000c8001";
const BOB_CONTACT_ID: &str = "00000000-0000-0000-0000-0000000c8002";
fn make_contact(link_id: Uuid, email: &str, name: Option<&str>) -> Contact {
    Contact {
        id: macro_uuid::generate_uuid_v7(),
        link_id,
        email_address: Some(email.to_string()),
        name: name.map(|n| n.to_string()),
        original_photo_url: None,
        sfs_photo_url: None,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_sync_contacts"))
)]
async fn detects_name_change(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str(LINK_ID)?;
    let alice_id = Uuid::parse_str(ALICE_CONTACT_ID)?;

    // Alice: "Old Alice" -> "New Alice"
    let contacts = vec![make_contact(
        link_id,
        "alice@example.com",
        Some("New Alice"),
    )];

    let (rows, changed) = upsert_contacts(&pool, &contacts).await?;
    assert!(rows > 0);
    assert_eq!(changed.len(), 1);
    assert_eq!(changed[0], alice_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_sync_contacts"))
)]
async fn detects_null_to_name(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str(LINK_ID)?;
    let bob_id = Uuid::parse_str(BOB_CONTACT_ID)?;

    // Bob: NULL -> "Bob Named"
    let contacts = vec![make_contact(link_id, "bob@example.com", Some("Bob Named"))];

    let (_, changed) = upsert_contacts(&pool, &contacts).await?;
    assert_eq!(changed.len(), 1);
    assert_eq!(changed[0], bob_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_sync_contacts"))
)]
async fn no_change_when_name_is_same(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str(LINK_ID)?;

    // Charlie: "Charlie" -> "Charlie" (no change)
    let contacts = vec![make_contact(
        link_id,
        "charlie@example.com",
        Some("Charlie"),
    )];

    let (_, changed) = upsert_contacts(&pool, &contacts).await?;
    assert!(changed.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_sync_contacts"))
)]
async fn no_change_when_new_name_is_null_and_old_exists(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str(LINK_ID)?;

    // Alice: "Old Alice" -> NULL (COALESCE keeps "Old Alice")
    let contacts = vec![make_contact(link_id, "alice@example.com", None)];

    let (_, changed) = upsert_contacts(&pool, &contacts).await?;
    assert!(changed.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_sync_contacts"))
)]
async fn new_contact_not_in_changed_ids(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str(LINK_ID)?;

    // Brand new contact, doesn't exist yet
    let contacts = vec![make_contact(
        link_id,
        "newperson@example.com",
        Some("New Person"),
    )];

    let (rows, changed) = upsert_contacts(&pool, &contacts).await?;
    assert_eq!(rows, 1);
    assert!(changed.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_sync_contacts"))
)]
async fn mixed_batch_only_returns_changed(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str(LINK_ID)?;
    let alice_id = Uuid::parse_str(ALICE_CONTACT_ID)?;
    let bob_id = Uuid::parse_str(BOB_CONTACT_ID)?;

    let contacts = vec![
        make_contact(link_id, "alice@example.com", Some("New Alice")), // name changed
        make_contact(link_id, "bob@example.com", Some("Bob Named")),   // null -> name
        make_contact(link_id, "charlie@example.com", Some("Charlie")), // unchanged
        make_contact(link_id, "newperson@example.com", Some("New")),   // new contact
    ];

    let (_, changed) = upsert_contacts(&pool, &contacts).await?;
    assert_eq!(changed.len(), 2);
    assert!(changed.contains(&alice_id));
    assert!(changed.contains(&bob_id));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn empty_input_returns_empty(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let (rows, changed) = upsert_contacts(&pool, &[]).await?;
    assert_eq!(rows, 0);
    assert!(changed.is_empty());

    Ok(())
}
