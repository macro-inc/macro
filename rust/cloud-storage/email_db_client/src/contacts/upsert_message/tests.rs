use super::*;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::db::contact::ContactPhotoless;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should fetch existing contacts by their email addresses
async fn fetch_contacts_by_emails_returns_existing_contacts(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let emails = vec![
        "existing1@example.com".to_string(),
        "existing2@example.com".to_string(),
    ];

    let res = fetch_contacts_by_emails(&pool, link_id, &emails).await?;

    assert_eq!(res.len(), 2);

    let email_addresses: Vec<&str> = res.iter().map(|r| r.email_address.as_str()).collect();
    assert!(email_addresses.contains(&"existing1@example.com"));
    assert!(email_addresses.contains(&"existing2@example.com"));

    // Verify correct IDs are returned
    let expected_id_1 = Uuid::parse_str("00000000-0000-0000-0000-0000000c0001")?;
    let expected_id_2 = Uuid::parse_str("00000000-0000-0000-0000-0000000c0002")?;
    let ids: Vec<Uuid> = res.iter().map(|r| r.id).collect();
    assert!(ids.contains(&expected_id_1));
    assert!(ids.contains(&expected_id_2));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should return empty when no matching emails exist
async fn fetch_contacts_by_emails_returns_empty_for_nonexistent(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let emails = vec![
        "nonexistent1@example.com".to_string(),
        "nonexistent2@example.com".to_string(),
    ];

    let res = fetch_contacts_by_emails(&pool, link_id, &emails).await?;

    assert!(res.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should only return contacts for the specified link_id
async fn fetch_contacts_by_emails_respects_link_id_isolation(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    // Link B has a contact with existing1@example.com but different ID
    let link_b_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001b")?;
    let emails = vec!["existing1@example.com".to_string()];

    let res = fetch_contacts_by_emails(&pool, link_b_id, &emails).await?;

    assert_eq!(res.len(), 1);
    // Should return Link B's contact, not Link A's
    let expected_link_b_contact_id = Uuid::parse_str("00000000-0000-0000-0000-0000000c0004")?;
    assert_eq!(res[0].id, expected_link_b_contact_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should return partial results when some emails exist and some don't
async fn fetch_contacts_by_emails_returns_partial_matches(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let emails = vec![
        "existing1@example.com".to_string(),
        "nonexistent@example.com".to_string(),
    ];

    let res = fetch_contacts_by_emails(&pool, link_id, &emails).await?;

    assert_eq!(res.len(), 1);
    assert_eq!(res[0].email_address, "existing1@example.com");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should successfully insert new contacts
async fn insert_new_contacts_creates_contacts(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let new_contact_id_1 = Uuid::parse_str("00000000-0000-0000-0000-0000000d0001")?;
    let new_contact_id_2 = Uuid::parse_str("00000000-0000-0000-0000-0000000d0002")?;

    let contacts = vec![
        ContactPhotoless {
            id: new_contact_id_1,
            link_id,
            email_address: "newcontact1@example.com".to_string(),
            name: Some("New Contact One".to_string()),
        },
        ContactPhotoless {
            id: new_contact_id_2,
            link_id,
            email_address: "newcontact2@example.com".to_string(),
            name: Some("New Contact Two".to_string()),
        },
    ];

    let res = insert_new_contacts(&pool, &contacts).await?;

    assert_eq!(res.len(), 2);

    let email_addresses: Vec<&str> = res.iter().map(|r| r.email_address.as_str()).collect();
    assert!(email_addresses.contains(&"newcontact1@example.com"));
    assert!(email_addresses.contains(&"newcontact2@example.com"));

    // Verify the correct IDs are returned
    let ids: Vec<Uuid> = res.iter().map(|r| r.id).collect();
    assert!(ids.contains(&new_contact_id_1));
    assert!(ids.contains(&new_contact_id_2));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should insert contacts with null names
async fn insert_new_contacts_handles_null_names(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let new_contact_id = Uuid::parse_str("00000000-0000-0000-0000-0000000d0003")?;

    let contacts = vec![ContactPhotoless {
        id: new_contact_id,
        link_id,
        email_address: "nullname@example.com".to_string(),
        name: None,
    }];

    let res = insert_new_contacts(&pool, &contacts).await?;

    assert_eq!(res.len(), 1);
    assert_eq!(res[0].email_address, "nullname@example.com");
    assert_eq!(res[0].id, new_contact_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should handle conflict by doing nothing and not returning conflicting rows
async fn insert_new_contacts_handles_conflict_on_existing_email(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let new_contact_id = Uuid::parse_str("00000000-0000-0000-0000-0000000d0004")?;

    // Try to insert a contact with an email that already exists
    let contacts = vec![ContactPhotoless {
        id: new_contact_id,
        link_id,
        email_address: "existing1@example.com".to_string(), // Already exists in fixture
        name: Some("Duplicate Contact".to_string()),
    }];

    let res = insert_new_contacts(&pool, &contacts).await?;

    // Should return empty because ON CONFLICT DO NOTHING doesn't return skipped rows
    assert!(res.is_empty());

    // Verify original contact is unchanged
    let fetch_res =
        fetch_contacts_by_emails(&pool, link_id, &["existing1@example.com".to_string()]).await?;
    assert_eq!(fetch_res.len(), 1);
    // Should still have the original ID
    let original_id = Uuid::parse_str("00000000-0000-0000-0000-0000000c0001")?;
    assert_eq!(fetch_res[0].id, original_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should insert new contacts and skip existing ones in a mixed batch
async fn insert_new_contacts_mixed_new_and_existing(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let new_contact_id = Uuid::parse_str("00000000-0000-0000-0000-0000000d0005")?;
    let conflict_contact_id = Uuid::parse_str("00000000-0000-0000-0000-0000000d0006")?;

    let contacts = vec![
        ContactPhotoless {
            id: new_contact_id,
            link_id,
            email_address: "brandnew@example.com".to_string(),
            name: Some("Brand New Contact".to_string()),
        },
        ContactPhotoless {
            id: conflict_contact_id,
            link_id,
            email_address: "existing2@example.com".to_string(), // Already exists
            name: Some("Should Be Skipped".to_string()),
        },
    ];

    let res = insert_new_contacts(&pool, &contacts).await?;

    // Only the new contact should be returned
    assert_eq!(res.len(), 1);
    assert_eq!(res[0].email_address, "brandnew@example.com");
    assert_eq!(res[0].id, new_contact_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should return empty when inserting empty contacts slice
async fn insert_new_contacts_handles_empty_input(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let contacts: Vec<ContactPhotoless> = vec![];

    let res = insert_new_contacts(&pool, &contacts).await?;

    assert!(res.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should handle empty emails slice in fetch
async fn fetch_contacts_by_emails_handles_empty_input(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let emails: Vec<String> = vec![];

    let res = fetch_contacts_by_emails(&pool, link_id, &emails).await?;

    assert!(res.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("upsert_message_contacts"))
)]
// should allow same email for different link_ids
async fn insert_new_contacts_allows_same_email_different_links(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let link_a_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001a")?;
    let link_b_id = Uuid::parse_str("00000000-0000-0000-0000-00000000001b")?;
    let new_contact_id_a = Uuid::parse_str("00000000-0000-0000-0000-0000000d0007")?;
    let new_contact_id_b = Uuid::parse_str("00000000-0000-0000-0000-0000000d0008")?;

    // Insert same email for Link A
    let contacts_a = vec![ContactPhotoless {
        id: new_contact_id_a,
        link_id: link_a_id,
        email_address: "sharednewemail@example.com".to_string(),
        name: Some("Contact for Link A".to_string()),
    }];

    let res_a = insert_new_contacts(&pool, &contacts_a).await?;
    assert_eq!(res_a.len(), 1);

    // Insert same email for Link B
    let contacts_b = vec![ContactPhotoless {
        id: new_contact_id_b,
        link_id: link_b_id,
        email_address: "sharednewemail@example.com".to_string(),
        name: Some("Contact for Link B".to_string()),
    }];

    let res_b = insert_new_contacts(&pool, &contacts_b).await?;
    assert_eq!(res_b.len(), 1);

    // Both should exist with different IDs
    assert_eq!(res_a[0].id, new_contact_id_a);
    assert_eq!(res_b[0].id, new_contact_id_b);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("update_missing_contact_names"))
)]
// should update name for a contact that has no name
async fn update_missing_contact_names_sets_name_when_null(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let contact_id = Uuid::parse_str("00000000-0000-0000-0000-0000000c0002")?;
    let updates = vec![(contact_id, "Now Has A Name".to_string())];

    update_missing_contact_names(&pool, &updates).await?;

    let row = sqlx::query!("SELECT name FROM email_contacts WHERE id = $1", contact_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(row.name.as_deref(), Some("Now Has A Name"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("update_missing_contact_names"))
)]
// should not overwrite an existing name
async fn update_missing_contact_names_does_not_overwrite_existing_name(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let contact_id = Uuid::parse_str("00000000-0000-0000-0000-0000000c0001")?;
    let updates = vec![(contact_id, "Should Not Replace".to_string())];

    update_missing_contact_names(&pool, &updates).await?;

    let row = sqlx::query!("SELECT name FROM email_contacts WHERE id = $1", contact_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(row.name.as_deref(), Some("Already Has Name"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("update_missing_contact_names"))
)]
// should handle a batch with mixed null and non-null existing names
async fn update_missing_contact_names_mixed_batch(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let has_name_id = Uuid::parse_str("00000000-0000-0000-0000-0000000c0001")?;
    let no_name_id = Uuid::parse_str("00000000-0000-0000-0000-0000000c0002")?;
    let no_name_2_id = Uuid::parse_str("00000000-0000-0000-0000-0000000c0003")?;

    let updates = vec![
        (has_name_id, "Should Not Replace".to_string()),
        (no_name_id, "New Name One".to_string()),
        (no_name_2_id, "New Name Two".to_string()),
    ];

    update_missing_contact_names(&pool, &updates).await?;

    let has_name_row = sqlx::query!("SELECT name FROM email_contacts WHERE id = $1", has_name_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(has_name_row.name.as_deref(), Some("Already Has Name"));

    let no_name_row = sqlx::query!("SELECT name FROM email_contacts WHERE id = $1", no_name_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(no_name_row.name.as_deref(), Some("New Name One"));

    let no_name_2_row = sqlx::query!(
        "SELECT name FROM email_contacts WHERE id = $1",
        no_name_2_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(no_name_2_row.name.as_deref(), Some("New Name Two"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("update_missing_contact_names"))
)]
// should handle empty updates slice without error
async fn update_missing_contact_names_empty_input(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let updates: Vec<(Uuid, String)> = vec![];

    update_missing_contact_names(&pool, &updates).await?;

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("update_missing_contact_names"))
)]
// should update updated_at timestamp when name is set
async fn update_missing_contact_names_updates_timestamp(pool: Pool<Postgres>) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let contact_id = Uuid::parse_str("00000000-0000-0000-0000-0000000c0002")?;

    let before = sqlx::query!(
        "SELECT updated_at FROM email_contacts WHERE id = $1",
        contact_id
    )
    .fetch_one(&pool)
    .await?;

    let updates = vec![(contact_id, "Updated Name".to_string())];
    update_missing_contact_names(&pool, &updates).await?;

    let after = sqlx::query!(
        "SELECT updated_at FROM email_contacts WHERE id = $1",
        contact_id
    )
    .fetch_one(&pool)
    .await?;

    assert!(after.updated_at > before.updated_at);

    Ok(())
}
