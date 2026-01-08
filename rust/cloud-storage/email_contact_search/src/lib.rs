#![deny(missing_docs)]

//! This crate contains the queries to search over macrodb for your email contacts

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Pool, Postgres};

/// Errors for email contact search crate
#[derive(Debug, thiserror::Error)]
pub enum EmailContactSearchError {
    /// Database error
    #[error("database error occurred {0}")]
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
    /// The id of the message where the match was found
    pub message_id: uuid::Uuid,
    /// The contact name that was matched on
    pub contact_name: Option<String>,
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
        WITH paginated_threads AS (
            SELECT t.id, t.latest_non_spam_message_ts
            FROM email_threads t
            WHERE t.link_id = (SELECT id FROM email_links WHERE macro_id = $1)
              AND t.latest_non_spam_message_ts IS NOT NULL
              AND EXISTS (
                  -- Check for sender matches
                  SELECT 1
                  FROM email_messages m
                  JOIN email_contacts c ON c.id = m.from_contact_id
                  WHERE m.thread_id = t.id
                    AND (c.name ILIKE $2 OR c.email_address ILIKE $2 OR m.from_name ILIKE $2)

                  UNION ALL

                  -- Check for recipient matches
                  SELECT 1
                  FROM email_messages m
                  JOIN email_message_recipients mr ON mr.message_id = m.id
                  JOIN email_contacts c ON c.id = mr.contact_id
                  WHERE m.thread_id = t.id
                    AND (c.name ILIKE $2 OR c.email_address ILIKE $2 OR mr.name ILIKE $2)
              )
            ORDER BY t.latest_non_spam_message_ts DESC
            LIMIT $3 OFFSET $4
        )
        SELECT
            pt.id as "thread_id!",
            matches.message_id as "message_id!",
            matches.contact_name as "contact_name?",
            matches.contact_email as "contact_email!",
            matches.contact_type as "contact_type!"
        FROM paginated_threads pt
        CROSS JOIN LATERAL (
            -- Sender matches: check contact.name, contact.email_address, and message.from_name
            SELECT DISTINCT
                m.id as message_id,
                COALESCE(m.from_name, c.name) as contact_name,
                c.email_address as contact_email,
                'FROM'::text as contact_type
            FROM email_messages m
            JOIN email_contacts c ON c.id = m.from_contact_id
            WHERE m.thread_id = pt.id
              AND (c.name ILIKE $2 OR c.email_address ILIKE $2 OR m.from_name ILIKE $2)

            UNION

            -- Recipient matches: check contact.name, contact.email_address, and recipient.name
            SELECT DISTINCT
                m.id as message_id,
                COALESCE(mr.name, c.name) as contact_name,
                c.email_address as contact_email,
                mr.recipient_type::text as contact_type
            FROM email_messages m
            JOIN email_message_recipients mr ON mr.message_id = m.id
            JOIN email_contacts c ON c.id = mr.contact_id
            WHERE m.thread_id = pt.id
              AND (c.name ILIKE $2 OR c.email_address ILIKE $2 OR mr.name ILIKE $2)
        ) matches(message_id, contact_name, contact_email, contact_type)
        ORDER BY pt.latest_non_spam_message_ts DESC
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
            message_id: row.message_id,
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
