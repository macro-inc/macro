#[cfg(test)]
mod tests;

use crate::contacts::normalize;
use anyhow::Context;
use models_email::db;
use models_email::db::contact::ContactPhotoless;
use models_email::db::{address, message};
use sqlx::PgPool;
use sqlx::types::Uuid;
use std::collections::HashMap;

/// upsert methods used when inserting individual threads/messages into the database.
/// wrapper around insert_email_address to format the data into a usable shape
pub async fn parse_and_upsert_message_contacts(
    pool: &PgPool,
    link_id: Uuid,
    addresses_data: address::ParsedAddresses,
) -> anyhow::Result<address::UpsertedRecipients> {
    // ensure we don't process the same email addresses more than once
    let mut unique_addresses_map: HashMap<String, Option<String>> = HashMap::new();

    let mut all_parsed_addrs: Vec<&address::EmailAddress> = Vec::new();
    if let Some(from) = &addresses_data.from {
        all_parsed_addrs.push(from);
    }
    all_parsed_addrs.extend(addresses_data.to.iter());
    all_parsed_addrs.extend(addresses_data.cc.iter());
    all_parsed_addrs.extend(addresses_data.bcc.iter());

    for addr in all_parsed_addrs {
        unique_addresses_map
            .entry(addr.email_address.clone().to_lowercase())
            .or_insert_with(|| addr.name.clone());
    }

    let mut results = address::UpsertedRecipients::default();
    if unique_addresses_map.is_empty() {
        return Ok(results);
    }

    let addresses_to_upsert: Vec<ContactPhotoless> = unique_addresses_map
        .into_iter()
        .map(|(email_address, name)| ContactPhotoless {
            id: macro_uuid::generate_uuid_v7(),
            link_id,
            email_address,
            name,
        })
        .collect();

    match upsert_message_contacts(pool, addresses_to_upsert).await {
        Ok(email_to_id_map) => {
            if let Some(ref from_addr) = addresses_data.from {
                let normalized_from = from_addr.email_address.to_lowercase();
                if let Some(id) = email_to_id_map.get(&normalized_from) {
                    results.from_contact_id = Some(*id);
                } else {
                    tracing::error!(email=%from_addr.email_address,"From ID missing post-upsert");
                }
            }

            let mut db_recipients = Vec::new();
            let recipient_groups = [
                (&addresses_data.to, address::EmailRecipientType::To),
                (&addresses_data.cc, address::EmailRecipientType::Cc),
                (&addresses_data.bcc, address::EmailRecipientType::Bcc),
            ];

            for (addr_vec, recip_type) in recipient_groups.iter() {
                for addr in *addr_vec {
                    let normalized_email = addr.email_address.to_lowercase();
                    if let Some(id) = email_to_id_map.get(&normalized_email) {
                        db_recipients.push(message::MessageRecipient {
                            contact_id: *id,
                            recipient_type: recip_type.clone(),
                            name: addr.name.clone(),
                        });
                    } else {
                        tracing::error!(email=%addr.email_address, type=?recip_type, "Recipient ID missing post-upsert");
                    }
                }
            }
            results.recipients = db_recipients;
        }
        Err(e) => {
            return Err(e).context("Failed during batch upsert of email addresses");
        }
    }

    Ok(results)
}

/// inserts email addresses into the database in a batch
#[tracing::instrument(skip(pool, contacts))]
async fn upsert_message_contacts(
    pool: &PgPool,
    contacts: Vec<ContactPhotoless>,
) -> anyhow::Result<HashMap<String, Uuid>> {
    if contacts.is_empty() {
        return Ok(HashMap::new());
    }

    let contacts: Vec<_> = contacts
        .into_iter()
        .map(normalize::normalize_contact)
        .collect();

    let link_id = contacts[0].link_id;
    let emails: Vec<String> = contacts.iter().map(|c| c.email_address.clone()).collect();

    // Step 1: Fetch existing (fast, no locks)
    let existing = fetch_contacts_by_emails(pool, link_id, &emails).await?;

    let mut result_map: HashMap<String, Uuid> = existing
        .into_iter()
        .map(|r| (r.email_address, r.id))
        .collect();

    // Step 2: Filter to contacts we don't have yet
    let new_contacts: Vec<_> = contacts
        .into_iter()
        .filter(|c| !result_map.contains_key(&c.email_address))
        .collect();

    if new_contacts.is_empty() {
        return Ok(result_map);
    }

    // Step 3: Try to insert new contacts
    let inserted = insert_new_contacts(pool, &new_contacts).await?;

    let new_emails: Vec<String> = new_contacts
        .iter()
        .map(|c| c.email_address.clone())
        .collect();

    for row in inserted {
        result_map.insert(row.email_address, row.id);
    }

    // Step 4: Any still missing? Fetch them (handles race condition)
    let still_missing: Vec<String> = new_emails
        .iter()
        .filter(|e| !result_map.contains_key(*e))
        .cloned()
        .collect();

    if !still_missing.is_empty() {
        let fetched = fetch_contacts_by_emails(pool, link_id, &still_missing).await?;

        for row in fetched {
            result_map.insert(row.email_address, row.id);
        }
    }

    Ok(result_map)
}

async fn fetch_contacts_by_emails(
    pool: &PgPool,
    link_id: Uuid,
    emails: &[String],
) -> anyhow::Result<Vec<address::FetchedAddressId>> {
    let results = sqlx::query_as!(
        address::FetchedAddressId,
        r#"
        SELECT id, email_address
        FROM email_contacts
        WHERE link_id = $1 AND email_address = ANY($2)
        "#,
        link_id,
        emails
    )
    .fetch_all(pool)
    .await?;

    Ok(results)
}

async fn insert_new_contacts(
    pool: &PgPool,
    contacts: &[ContactPhotoless],
) -> anyhow::Result<Vec<address::FetchedAddressId>> {
    let mut ids: Vec<Uuid> = Vec::with_capacity(contacts.len());
    let mut link_ids: Vec<Uuid> = Vec::with_capacity(contacts.len());
    let mut emails: Vec<String> = Vec::with_capacity(contacts.len());
    let mut names: Vec<Option<String>> = Vec::with_capacity(contacts.len());

    for contact in contacts {
        ids.push(contact.id);
        link_ids.push(contact.link_id);
        emails.push(contact.email_address.clone());
        names.push(contact.name.clone());
    }

    let inserted = sqlx::query_as!(
        address::FetchedAddressId,
        r#"
        INSERT INTO email_contacts (id, link_id, email_address, name)
        SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])
        ON CONFLICT (link_id, email_address) DO NOTHING
        RETURNING id, email_address
        "#,
        &ids,
        &link_ids,
        &emails,
        &names as _
    )
    .fetch_all(pool)
    .await?;

    Ok(inserted)
}

/// inserts the recipients of an email into the database in a batch
pub async fn upsert_message_recipients(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    upserted_recipients: &address::UpsertedRecipients,
) -> anyhow::Result<()> {
    if upserted_recipients.recipients.is_empty() {
        return Ok(());
    }

    let n = upserted_recipients.recipients.len();
    let mut message_ids_to_insert: Vec<Uuid> = Vec::with_capacity(n);
    let mut contact_ids_to_insert: Vec<Uuid> = Vec::with_capacity(n);
    let mut names_to_insert: Vec<Option<String>> = Vec::with_capacity(n);
    let mut recipient_types_to_insert: Vec<address::EmailRecipientType> = Vec::with_capacity(n);

    for recipient in &upserted_recipients.recipients {
        message_ids_to_insert.push(message_id);
        contact_ids_to_insert.push(recipient.contact_id);
        names_to_insert.push(recipient.name.clone());
        recipient_types_to_insert.push(recipient.recipient_type.clone());
    }

    // Delete existing recipients for the message_id that don't match the values we are about to
    // insert, in case this is an upsert and some values got removed since the last insert (think drafts)
    sqlx::query!(
        r#"
        DELETE FROM email_message_recipients
        WHERE message_id = $1
          AND (contact_id, recipient_type) NOT IN (
              SELECT contact_id, recipient_type
              FROM unnest($2::uuid[], $3::email_recipient_type[])
              AS t(contact_id, recipient_type)
          )
        "#,
        message_id,
        &contact_ids_to_insert,
        &recipient_types_to_insert as &[db::address::EmailRecipientType]
    )
        .execute(&mut *tx)
        .await
        .with_context(|| format!(
            "Failed to delete old message recipients. message_id: {}, contact_ids_to_insert: {:?}, recipient_types_to_insert: {:?}",
            message_id, contact_ids_to_insert, recipient_types_to_insert
        ))?;

    sqlx::query!(
        r#"
        INSERT INTO email_message_recipients (message_id, contact_id, name, recipient_type)
        SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::email_recipient_type[])
        ON CONFLICT (message_id, contact_id, recipient_type) DO NOTHING
        "#,
        &message_ids_to_insert,
        &contact_ids_to_insert,
        &names_to_insert as &[Option<String>],
        &recipient_types_to_insert as &[db::address::EmailRecipientType]
    )
        .execute(&mut *tx)
        .await
        .with_context(|| format!(
            "Failed to batch insert message recipients. message_ids_to_insert: {:?}, contact_ids_to_insert: {:?}, recipient_types_to_insert: {:?}",
            message_ids_to_insert, contact_ids_to_insert, recipient_types_to_insert
        ))?;

    Ok(())
}
