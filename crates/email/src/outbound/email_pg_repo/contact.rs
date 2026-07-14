use crate::domain::models::{ParsedAddresses, RecipientType, UpsertedContacts, UpsertedRecipient};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

/// Upsert contacts from parsed addresses. Called outside a transaction to avoid deadlocks.
#[tracing::instrument(skip(pool, addresses), err)]
pub(crate) async fn upsert_contacts(
    pool: &PgPool,
    link_id: Uuid,
    addresses: ParsedAddresses,
) -> Result<UpsertedContacts, sqlx::Error> {
    // Collect all unique email addresses and normalize names
    let mut unique_map: HashMap<String, Option<String>> = HashMap::new();

    let from_lower = addresses.from_email.to_lowercase();
    let from_name_normalized =
        email_utils::normalize_contact_name(&from_lower, addresses.from_name.as_deref());
    unique_map.entry(from_lower).or_insert(from_name_normalized);

    for contact in addresses
        .to
        .iter()
        .chain(addresses.cc.iter())
        .chain(addresses.bcc.iter())
    {
        let email_lower = contact.email.to_lowercase();
        unique_map.entry(email_lower.clone()).or_insert_with(|| {
            email_utils::normalize_contact_name(&email_lower, contact.name.as_deref())
        });
    }

    if unique_map.is_empty() {
        return Ok(UpsertedContacts {
            from_contact_id: None,
            recipients: vec![],
        });
    }

    let mut ids: Vec<Uuid> = Vec::with_capacity(unique_map.len());
    let mut link_ids: Vec<Uuid> = Vec::with_capacity(unique_map.len());
    let mut emails: Vec<String> = Vec::with_capacity(unique_map.len());
    let mut names: Vec<Option<String>> = Vec::with_capacity(unique_map.len());

    for (email, name) in &unique_map {
        ids.push(macro_uuid::generate_uuid_v7());
        link_ids.push(link_id);
        emails.push(email.clone());
        names.push(name.clone());
    }

    // Step 1: Fetch existing contacts
    let existing = sqlx::query!(
        r#"
        SELECT id, email_address
        FROM email_contacts
        WHERE link_id = $1 AND email_address = ANY($2)
        "#,
        link_id,
        &emails,
    )
    .fetch_all(pool)
    .await?;

    let mut email_to_id: HashMap<String, Uuid> = existing
        .into_iter()
        .map(|r| (r.email_address, r.id))
        .collect();

    // Step 2: Update names for existing contacts that don't have one yet
    let name_updates: Vec<(Uuid, String)> = unique_map
        .iter()
        .filter_map(|(email, name)| {
            name.as_ref()
                .and_then(|n| email_to_id.get(email).map(|id| (*id, n.clone())))
        })
        .collect();

    if !name_updates.is_empty() {
        let update_ids: Vec<Uuid> = name_updates.iter().map(|(id, _)| *id).collect();
        let update_names: Vec<String> = name_updates.iter().map(|(_, name)| name.clone()).collect();
        sqlx::query!(
            r#"
            UPDATE email_contacts
            SET name = data.name, updated_at = now()
            FROM (SELECT unnest($1::uuid[]) as id, unnest($2::text[]) as name) as data
            WHERE email_contacts.id = data.id
              AND email_contacts.name IS NULL
            "#,
            &update_ids,
            &update_names,
        )
        .execute(pool)
        .await?;
    }

    // Step 3: Insert new contacts
    let new_ids: Vec<Uuid> = ids
        .iter()
        .zip(emails.iter())
        .filter(|(_, e)| !email_to_id.contains_key(*e))
        .map(|(id, _)| *id)
        .collect();
    let new_link_ids: Vec<Uuid> = new_ids.iter().map(|_| link_id).collect();
    let new_emails: Vec<String> = emails
        .iter()
        .filter(|e| !email_to_id.contains_key(*e))
        .cloned()
        .collect();
    let new_names: Vec<Option<String>> = new_emails
        .iter()
        .map(|e| unique_map.get(e).cloned().flatten())
        .collect();

    if !new_emails.is_empty() {
        let inserted = sqlx::query!(
            r#"
            INSERT INTO email_contacts (id, link_id, email_address, name)
            SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])
            ON CONFLICT (link_id, email_address) DO NOTHING
            RETURNING id, email_address
            "#,
            &new_ids,
            &new_link_ids,
            &new_emails,
            &new_names as &[Option<String>],
        )
        .fetch_all(pool)
        .await?;

        for row in inserted {
            email_to_id.insert(row.email_address, row.id);
        }

        // Step 4: Handle race conditions - fetch any still-missing contacts
        let still_missing: Vec<String> = new_emails
            .iter()
            .filter(|e| !email_to_id.contains_key(*e))
            .cloned()
            .collect();

        if !still_missing.is_empty() {
            let fetched = sqlx::query!(
                r#"
                SELECT id, email_address
                FROM email_contacts
                WHERE link_id = $1 AND email_address = ANY($2)
                "#,
                link_id,
                &still_missing,
            )
            .fetch_all(pool)
            .await?;

            for row in fetched {
                email_to_id.insert(row.email_address, row.id);
            }
        }
    }

    // Build the result
    let from_normalized = addresses.from_email.to_lowercase();
    let from_contact_id = email_to_id.get(&from_normalized).copied();

    let mut recipients = Vec::new();
    let recipient_groups = [
        (&addresses.to, RecipientType::To),
        (&addresses.cc, RecipientType::Cc),
        (&addresses.bcc, RecipientType::Bcc),
    ];

    for (addr_vec, kind) in &recipient_groups {
        for addr in *addr_vec {
            let normalized = addr.email.to_lowercase();
            if let Some(id) = email_to_id.get(&normalized) {
                recipients.push(UpsertedRecipient {
                    contact_id: *id,
                    name: addr.name.clone(),
                    recipient_type: *kind,
                });
            } else {
                tracing::error!(email=%addr.email, type_=?kind, "Recipient ID missing post-upsert");
            }
        }
    }

    Ok(UpsertedContacts {
        from_contact_id,
        recipients,
    })
}
