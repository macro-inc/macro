#![deny(missing_docs)]

//! This crate contains the queries to search over macrodb for your email contacts

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Pool, Postgres};

/// Errors for email contact search crate
#[derive(Debug, thiserror::Error)]
pub enum EmailContactSearchError {
    /// Database error
    #[error("database error occurred")]
    DatabaseError(#[from] sqlx::Error),
    /// Empty search term
    #[error("empty search term provided")]
    EmptySearchTerm,
}

/// The contact type for the match
#[derive(Debug, Clone, serde::Serialize)]
pub enum ContactType {
    /// To
    To,
    /// From
    From,
    /// Cc
    Cc,
    /// Bcc
    Bcc,
}

/// Email thread contact match result
#[derive(Debug, Clone, serde::Serialize)]
pub struct EmailContactMatchThreadResult {
    /// The id of the thread
    pub thread_id: uuid::Uuid,
    /// The contact name that was matched on
    pub contact_name: String,
    /// The contact email address
    pub contact_email: String,
    /// The contact type of the match
    pub contact_type: ContactType,
}

/// Search over your email contacts to find potential contact name matches
#[tracing::instrument(skip(db), err)]
pub async fn search_email_contacts<'a>(
    db: &Pool<Postgres>,
    macro_user_id: MacroUserId<Lowercase<'a>>,
    term: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<EmailContactMatchThreadResult>, EmailContactSearchError> {
    if term.is_empty() {
        return Err(EmailContactSearchError::EmptySearchTerm);
    }

    let search_pattern = format!("%{term}%");

    let rows = sqlx::query!(
        r#"
        WITH user_links AS (
            SELECT id FROM email_links WHERE macro_id = $1
        ),
        -- Sender matches (From) - search both from_name and contact name
        sender_matches AS (
            SELECT DISTINCT ON (t.id, c.id)
                t.id as thread_id,
                COALESCE(m.from_name, c.name) as contact_name,
                c.email_address as contact_email,
                'FROM' as contact_type,
                t.latest_non_spam_message_ts
            FROM email_threads t
            JOIN email_messages m ON m.thread_id = t.id
            JOIN email_contacts c ON c.id = m.from_contact_id
            WHERE t.link_id IN (SELECT id FROM user_links)
              AND (m.from_name ILIKE $2 OR c.name ILIKE $2)
            ORDER BY t.id, c.id
        ),
        -- Recipient matches (To/Cc/Bcc) - search both recipient name and contact name
        recipient_matches AS (
            SELECT DISTINCT ON (t.id, c.id, mr.recipient_type)
                t.id as thread_id,
                COALESCE(mr.name, c.name) as contact_name,
                c.email_address as contact_email,
                mr.recipient_type::text as contact_type,
                t.latest_non_spam_message_ts
            FROM email_threads t
            JOIN email_messages m ON m.thread_id = t.id
            JOIN email_message_recipients mr ON mr.message_id = m.id
            JOIN email_contacts c ON c.id = mr.contact_id
            WHERE t.link_id IN (SELECT id FROM user_links)
              AND (mr.name ILIKE $2 OR c.name ILIKE $2)
            ORDER BY t.id, c.id, mr.recipient_type
        )
        SELECT
            thread_id as "thread_id!",
            contact_name as "contact_name!",
            contact_email as "contact_email!",
            contact_type as "contact_type!"
        FROM (
            SELECT * FROM sender_matches
            UNION ALL
            SELECT * FROM recipient_matches
        ) combined
        ORDER BY latest_non_spam_message_ts DESC NULLS LAST
        LIMIT $3 OFFSET $4
        "#,
        macro_user_id.as_ref(),
        search_pattern,
        limit as i64,
        offset as i64,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| EmailContactMatchThreadResult {
            thread_id: row.thread_id,
            contact_name: row.contact_name,
            contact_email: row.contact_email,
            contact_type: match row.contact_type.as_str() {
                "TO" => ContactType::To,
                "CC" => ContactType::Cc,
                "BCC" => ContactType::Bcc,
                _ => ContactType::From,
            },
        })
        .collect())
}

#[cfg(test)]
mod test;
