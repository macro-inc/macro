#[cfg(test)]
mod test;

use crate::parse::service_to_db::map_new_contact_to_db;
use models_email::db;
use models_email::service::contact::Contact;
use sqlx::PgPool;
use sqlx::types::Uuid;
use std::collections::HashMap;

/// Upsert methods used by contact sync process, triggered by initial backfill and daily cron.
/// Upserts multiple contacts into the contacts table.
/// Returns (rows_affected, contact_ids_with_name_changes).
#[tracing::instrument(skip(pool, contacts), err)]
pub async fn upsert_contacts(
    pool: &PgPool,
    contacts: &[Contact],
) -> anyhow::Result<(u64, Vec<Uuid>)> {
    if contacts.is_empty() {
        return Ok((0, Vec::new()));
    }

    let db_contacts: Vec<db::contact::Contact> =
        contacts.iter().map(map_new_contact_to_db).collect();

    // Filter out contacts without email addresses and prepare vectors for bulk insert
    let mut ids = Vec::new();
    let mut link_ids = Vec::new();
    let mut email_addresses = Vec::new();
    let mut names: Vec<Option<String>> = Vec::new();
    let mut original_photo_urls = Vec::new();
    let mut sfs_photo_urls = Vec::new();

    for contact in db_contacts {
        if let Some(email) = &contact.email_address
            && !email.trim().is_empty()
            && email.len() < 310
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
        return Ok((0, Vec::new()));
    }

    let existing_contacts = sqlx::query!(
        r#"
        SELECT id, email_address, name
        FROM email_contacts
        WHERE (link_id, email_address) IN (
            SELECT * FROM UNNEST($1::uuid[], $2::varchar[])
        )
        "#,
        &link_ids,
        &email_addresses
    )
    .fetch_all(pool)
    .await?;

    let old_names: HashMap<String, (Uuid, Option<String>)> = existing_contacts
        .into_iter()
        .map(|row| (row.email_address, (row.id, row.name)))
        .collect();

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
.await?;

    let changed_contact_ids: Vec<Uuid> = email_addresses
        .iter()
        .zip(names.iter())
        .filter_map(|(email, new_name)| {
            let (id, old_name) = old_names.get(email.as_str())?;
            // Mirror the COALESCE(EXCLUDED.name, email_contacts.name) logic
            let effective_new: Option<&String> = new_name.as_ref().or(old_name.as_ref());
            if effective_new != old_name.as_ref() {
                Some(*id)
            } else {
                None
            }
        })
        .collect();

    Ok((result.rows_affected(), changed_contact_ids))
}
