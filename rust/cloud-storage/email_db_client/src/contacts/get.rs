#[cfg(test)]
mod test;

use crate::parse::db_to_service::map_db_contact_to_service;
use anyhow::Context;
use chrono::{DateTime, Utc};
use email_utils::{dedupe_emails, is_generic_email};
use models_email::service::address;
use models_email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;
use std::collections::{HashMap, HashSet};

pub type ThreadContactsMap = HashMap<Uuid, Vec<(String, Option<String>)>>;

/// fetch message sender from db
#[tracing::instrument(skip(pool), err)]
pub async fn get_sender_by_message_id(
    pool: &PgPool,
    message_id: Uuid,
) -> anyhow::Result<Option<db::contact::Contact>> {
    let result = sqlx::query_as!(
        db::contact::Contact,
        r#"
            SELECT
                c.id,
                c.link_id,
                c.email_address,
                COALESCE(m.from_name, c.name) as "name", -- name from message overrides contact name
                c.original_photo_url,
                c.sfs_photo_url,
                c.created_at,
                c.updated_at
            FROM email_messages m
            INNER JOIN email_contacts c ON c.id = m.from_contact_id
            WHERE m.id = $1
            AND m.from_contact_id IS NOT NULL
        "#,
        message_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(result)
}

#[tracing::instrument(skip(executor), err)]
pub async fn get_senders_contacts_map<'e, E>(
    executor: E,
    message_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, db::contact::Contact>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let db_contacts = fetch_sender_contacts_by_message_ids(executor, message_ids).await?;

    // Convert Vec<Contact> to HashMap<Uuid, Contact>
    let contacts_map = db_contacts.into_iter().map(|c| (c.id, c)).collect();

    Ok(contacts_map)
}

// Temporary struct needed because query_as! cannot directly map joined results
// into two separate structs easily within the macro itself.
struct RecipientQueryResult {
    message_id: Uuid,
    id: Uuid,
    link_id: Uuid,
    email_address: String,
    name: Option<String>,
    original_photo_url: Option<String>,
    sfs_photo_url: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    recipient_type: db::address::EmailRecipientType,
}

/// fetch recipients (to, cc, bcc) from db
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_db_recipients(
    pool: &PgPool,
    message_db_id: Uuid,
) -> anyhow::Result<Vec<(db::contact::Contact, db::address::EmailRecipientType)>> {
    // Fetch address and recipient type together
    sqlx::query_as!(
        RecipientQueryResult,
        r#"
        SELECT
            mr.message_id,
            c.id,
            c.link_id,
            c.email_address,
            COALESCE(mr.name, c.name) as "name", -- name from message overrides contact name
            c.original_photo_url,
            c.sfs_photo_url,
            c.created_at,
            c.updated_at,
            mr.recipient_type as "recipient_type!: db::address::EmailRecipientType"
        FROM email_message_recipients mr
        JOIN email_contacts c ON mr.contact_id = c.id
        WHERE mr.message_id = $1
        ORDER BY mr.recipient_type
        "#,
        message_db_id
    )
    .map(|row| {
        (
            db::contact::Contact {
                id: row.id,
                link_id: row.link_id,
                email_address: Some(row.email_address),
                name: row.name,
                original_photo_url: row.original_photo_url,
                sfs_photo_url: row.sfs_photo_url,
                created_at: row.created_at,
                updated_at: row.updated_at,
            },
            row.recipient_type,
        )
    })
    .fetch_all(pool)
    .await
    .context("Failed to fetch recipients")
}

/// Fetches all recipients for a given list of message IDs in a single query
#[tracing::instrument(skip(executor), err)]
pub async fn fetch_db_recipients_in_bulk<'e, E>(
    executor: E,
    message_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, Vec<(db::contact::Contact, db::address::EmailRecipientType)>>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let results = sqlx::query_as!(
        RecipientQueryResult,
        r#"
        SELECT
            mr.message_id,
            c.id,
            c.link_id,
            c.email_address,
            COALESCE(mr.name, c.name) as "name", -- name from message overrides contact name
            c.original_photo_url,
            c.sfs_photo_url,
            c.created_at,
            c.updated_at,
            mr.recipient_type as "recipient_type!: db::address::EmailRecipientType"
        FROM email_messages m
        JOIN email_message_recipients mr ON m.id = mr.message_id
        JOIN email_contacts c ON mr.contact_id = c.id
        WHERE
            m.id = ANY($1)
        ORDER BY mr.message_id, mr.recipient_type
        "#,
        message_ids
    )
    .fetch_all(executor)
    .await
    .context("Failed to fetch recipients in bulk")?;

    let mut recipients_map = HashMap::new();
    for row in results {
        let email_address = db::contact::Contact {
            id: row.id,
            link_id: row.link_id,
            email_address: Some(row.email_address),
            original_photo_url: row.original_photo_url,
            sfs_photo_url: row.sfs_photo_url,
            name: row.name,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };

        recipients_map
            .entry(row.message_id)
            .or_insert_with(Vec::new)
            .push((email_address, row.recipient_type));
    }

    Ok(recipients_map)
}

/// Fetch UUID for a given email address
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_id_by_email(
    pool: &mut sqlx::PgConnection,
    link_id: Uuid,
    email_address: &str,
) -> anyhow::Result<Option<Uuid>> {
    sqlx::query_scalar!(
        r#"
        SELECT id
        FROM email_contacts
        WHERE LOWER(email_address) = LOWER($1) AND link_id = $2
        "#,
        email_address,
        link_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch contact ID for email address {}",
            email_address
        )
    })
}

/// Fetch contact for a given email address
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_contact_by_email(
    pool: &PgPool,
    link_id: Uuid,
    email_address: &str,
) -> anyhow::Result<Option<service::address::ContactInfo>> {
    let contact = sqlx::query_as!(
        db::contact::Contact,
        r#"
        SELECT id, link_id, email_address, name, original_photo_url, sfs_photo_url, created_at, updated_at
        FROM email_contacts
        WHERE LOWER(email_address) = LOWER($1) AND link_id = $2
        "#,
        email_address,
        link_id
    )
        .fetch_optional(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch contact for email address {}",
                email_address
            )
        })?;

    Ok(contact.and_then(|c| map_db_contact_to_service(Some(c))))
}

#[tracing::instrument(skip(pool), err)]
pub async fn fetch_sender_contact_info(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, address::ContactInfo>> {
    let db_contacts = fetch_sender_contacts_by_message_ids(pool, message_ids).await?;

    let mut result = HashMap::with_capacity(db_contacts.len());
    for addr in db_contacts {
        let id = addr.id;
        let contact_info = map_db_contact_to_service(Some(addr));
        result.insert(id, contact_info.unwrap()); // always exists since we are wrapping arg in option above
    }

    Ok(result)
}

#[tracing::instrument(skip(executor), err)]
pub async fn fetch_sender_contacts_by_message_ids<'e, E>(
    executor: E,
    message_ids: &[Uuid],
) -> anyhow::Result<Vec<db::contact::Contact>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Create a set of unique IDs to query
    let unique_ids: HashSet<Uuid> = message_ids.iter().cloned().collect();
    let unique_ids_vec: Vec<Uuid> = unique_ids.into_iter().collect();

    // Fetch all email addresses that exist
    sqlx::query_as!(
        db::contact::Contact,
        r#"
            SELECT
                c.id,
                c.link_id,
                c.email_address,
                COALESCE(m.from_name, c.name) as "name", -- name from message overrides contact name
                c.original_photo_url,
                c.sfs_photo_url,
                c.created_at,
                c.updated_at
            FROM email_messages m
            INNER JOIN email_contacts c ON c.id = m.from_contact_id
            WHERE m.id = ANY($1)
            AND m.from_contact_id IS NOT NULL
        "#,
        &unique_ids_vec
    )
    .fetch_all(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch email addresses with IDs: {:?}",
            unique_ids_vec
        )
    })
}

/// Fetches sender contacts for multiple messages and returns a map keyed by message_id
#[tracing::instrument(skip(executor), err)]
pub async fn fetch_senders_by_message_ids<'e, E>(
    executor: E,
    message_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, db::contact::Contact>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Temporary struct to capture message_id along with contact data
    struct SenderQueryResult {
        message_id: Uuid,
        id: Uuid,
        link_id: Uuid,
        email_address: Option<String>,
        name: Option<String>,
        original_photo_url: Option<String>,
        sfs_photo_url: Option<String>,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    }

    let results = sqlx::query_as!(
        SenderQueryResult,
        r#"
            SELECT
                m.id as message_id,
                c.id,
                c.link_id,
                c.email_address,
                COALESCE(m.from_name, c.name) as "name",
                c.original_photo_url,
                c.sfs_photo_url,
                c.created_at,
                c.updated_at
            FROM email_messages m
            INNER JOIN email_contacts c ON c.id = m.from_contact_id
            WHERE m.id = ANY($1)
            AND m.from_contact_id IS NOT NULL
        "#,
        message_ids
    )
    .fetch_all(executor)
    .await
    .context("Failed to fetch senders by message IDs")?;

    let mut senders_map = HashMap::new();
    for row in results {
        let contact = db::contact::Contact {
            id: row.id,
            link_id: row.link_id,
            email_address: row.email_address,
            name: row.name,
            original_photo_url: row.original_photo_url,
            sfs_photo_url: row.sfs_photo_url,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
        senders_map.insert(row.message_id, contact);
    }

    Ok(senders_map)
}

/// Fetches all unique sender contacts for given thread IDs, ordered by message creation time.
/// Returns a map of thread_id -> Vec<(email, name)>.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_contacts_by_thread_ids(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> anyhow::Result<ThreadContactsMap> {
    if thread_ids.is_empty() {
        return Ok(HashMap::new());
    }

    struct Row {
        thread_id: Uuid,
        email_address: String,
        name: Option<String>,
    }

    let rows = sqlx::query_as!(
        Row,
        r#"
        SELECT
            m.thread_id,
            c.email_address as "email_address!",
            COALESCE(m.from_name, c.name) as "name"
        FROM email_messages m
        JOIN email_contacts c ON m.from_contact_id = c.id
        WHERE m.thread_id = ANY($1) AND m.from_contact_id IS NOT NULL
        ORDER BY m.created_at ASC
        "#,
        thread_ids
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch contacts by thread IDs")?;

    let mut result: ThreadContactsMap = HashMap::new();
    for row in rows {
        let contacts = result.entry(row.thread_id).or_default();
        if !contacts
            .iter()
            .any(|(e, n)| *e == row.email_address && *n == row.name)
        {
            contacts.push((row.email_address, row.name));
        }
    }

    Ok(result)
}

/// returns all email addresses and names the passed link has sent emails to.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_contacts_by_link_id(
    pool: &PgPool,
    link_id: Uuid,
) -> anyhow::Result<Vec<address::ContactInfoWithInteraction>> {
    // Execute the query directly returning service::Contact objects
    let db_contacts = sqlx::query_as!(
        db::contact::ContactWithInteraction,
        r#"
        WITH
            -- Get all individual interactions with timestamps
            LinkMessageTimestamps AS (
                SELECT
                    m.link_id,
                    mr.contact_id AS contact_address_id,
                    m.internal_date_ts
                FROM
                    email_messages m
                JOIN
                    email_message_recipients mr ON m.id = mr.message_id
                WHERE
                    m.link_id = $1
                    AND m.is_sent = TRUE
                    AND mr.contact_id IS NOT NULL
            ),
            -- Get the latest interaction timestamp for each contact_address_id
            LatestContactInteractions AS (
                SELECT
                    lmt.link_id,
                    lmt.contact_address_id,
                    MAX(lmt.internal_date_ts) AS last_interaction_ts
                FROM
                    LinkMessageTimestamps lmt
                WHERE
                    lmt.contact_address_id IS NOT NULL
                GROUP BY
                    lmt.link_id,
                    lmt.contact_address_id
            )
        -- Final SELECT to join with email_addresses and get details
        SELECT
            c.email_address as "email_address!",
            c.name as "name?",
            c.sfs_photo_url as "photo_url?",
            lci.last_interaction_ts as "last_interaction!"
        FROM
            LatestContactInteractions lci
        JOIN
            email_contacts c ON lci.contact_address_id = c.id
        ORDER BY
            lci.last_interaction_ts DESC, c.email_address
        "#,
        link_id
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch contacts for link ID")?;

    Ok(db_contacts.into_iter().map(Into::into).collect())
}

/// returns all non-generic email addresses the passed link has sent emails to.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_contacts_emails_by_link_id(
    pool: &PgPool,
    link_id: Uuid,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query!(
        r#"
        SELECT DISTINCT
            c.email_address as "email_address!"
        FROM
            email_messages m
        JOIN
            email_message_recipients mr ON m.id = mr.message_id
        JOIN
            email_contacts c ON mr.contact_id = c.id
        WHERE
            m.link_id = $1
            AND m.is_sent = TRUE
            AND mr.contact_id IS NOT NULL
        ORDER BY
            c.email_address
        "#,
        link_id
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch contacts for link ID")?;

    let deduped = dedupe_emails(rows.into_iter().map(|row| row.email_address).collect());
    Ok(deduped
        .into_iter()
        .filter(|e| !is_generic_email(e))
        .collect())
}
