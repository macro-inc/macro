use crate::parse::service_to_db::map_new_contact_to_db;
use anyhow::Context;
use models_email::db;
use models_email::service::contact::Contact;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Upsert methods used by contact sync process, triggered by initial backfill and daily cron.
/// Upserts multiple contacts into the contacts table
#[tracing::instrument(skip(pool, contacts), level = "info")]
pub async fn upsert_contacts(pool: &PgPool, contacts: &[Contact]) -> anyhow::Result<u64> {
    if contacts.is_empty() {
        return Ok(0);
    }

    let db_contacts: Vec<db::contact::Contact> = contacts
        .iter()
        .map(|c| map_new_contact_to_db(c, macro_uuid::generate_uuid_v7()))
        .collect();

    // Filter out contacts without email addresses and prepare vectors for bulk insert
    let mut ids = Vec::new();
    let mut link_ids = Vec::new();
    let mut email_addresses = Vec::new();
    let mut names = Vec::new();
    let mut original_photo_urls = Vec::new();
    let mut sfs_photo_urls = Vec::new();

    for contact in db_contacts {
        if let Some(email) = &contact.email_address
            && !email.trim().is_empty()
        {
            ids.push(contact.id);
            link_ids.push(contact.link_id);
            email_addresses.push(email.to_lowercase()); // Normalize email
            names.push(contact.name.clone());
            original_photo_urls.push(contact.original_photo_url.clone());
            sfs_photo_urls.push(contact.sfs_photo_url.clone());
        }
    }

    if link_ids.is_empty() {
        tracing::warn!("No contacts with valid email addresses to insert");
        return Ok(0);
    }
    let result = sqlx::query!(
    r#"
    INSERT INTO email_contacts (id, link_id, email_address, name, original_photo_url, sfs_photo_url, updated_at)
    SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::varchar[], $4::varchar[], $5::text[], $6::text[]), NOW()
    ON CONFLICT (link_id, email_address)
    DO UPDATE SET
        -- Overwrite existing name - contact names take precedence over names included with emails
        name = COALESCE(EXCLUDED.name, email_contacts.name),
        original_photo_url = COALESCE(EXCLUDED.original_photo_url, email_contacts.original_photo_url),
        sfs_photo_url = COALESCE(EXCLUDED.sfs_photo_url, email_contacts.sfs_photo_url),
        updated_at = NOW()
    "#,
    &ids,
    &link_ids,
    &email_addresses,
    &names as &[Option<String>],
    &original_photo_urls as &[Option<String>],
    &sfs_photo_urls as &[Option<String>]
)
.execute(pool)
.await
.with_context(|| {
    format!(
        "Failed to insert {} contacts for link_id {}",
        link_ids.len(),
        // all contacts should have the same link_id
        link_ids.first().unwrap_or(&Uuid::default())
    )
})?;

    Ok(result.rows_affected())
}
