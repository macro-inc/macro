#![deny(missing_docs)]

//! This crate contains the queries to search over macrodb for your email contacts

#[cfg(not(test))]
use cached::proc_macro::cached;
use chrono::{DateTime, Utc};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_search_cursor::{
    PaginatedResult, SearchCursorAttributes, SearchCursorOption, SearchMethodCursor,
};
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
    /// The timestamp used for cursor-based pagination
    pub updated_at: DateTime<Utc>,
}

impl SearchCursorAttributes for EmailContactMatchThreadResult {
    fn entity_id(&self) -> uuid::Uuid {
        self.thread_id
    }

    fn updated_at(&self) -> DateTime<Utc> {
        self.updated_at
    }
}

/// Search over your email contacts to find potential contact name matches
#[tracing::instrument(skip(db), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
        result = true,
        key = "String",
        convert = r#"{ format!("{}-{}-{}-{}", macro_user_id.as_ref(), term, limit, cursor.as_ref().map(|c| format!("{}-{}", c.entity_id, c.updated_at)).unwrap_or_default()) }"#
    )
)]
pub async fn search_email_contacts<'a>(
    db: &Pool<Postgres>,
    macro_user_id: MacroUserId<Lowercase<'a>>,
    term: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<PaginatedResult<EmailContactMatchThreadResult>, EmailContactSearchError> {
    if term.is_empty() {
        return Err(EmailContactSearchError::EmptySearchTerm);
    }

    let search_pattern = format!("%{term}%");

    let (cursor_updated_at, cursor_entity_id) = cursor
        .as_ref()
        .map(|c| (Some(c.updated_at), Some(c.entity_id)))
        .unwrap_or((None, None));

    // Fetch limit + 1 to determine if there are more results
    let fetch_limit = limit as i64 + 1;

    let rows = sqlx::query!(
        r#"
        WITH paginated_threads AS (
            SELECT t.id, t.latest_non_spam_message_ts
            FROM email_threads t
            WHERE t.link_id = (SELECT id FROM email_links WHERE macro_id = $1)
              AND t.latest_non_spam_message_ts IS NOT NULL
              AND (
                  $4::timestamptz IS NULL
                  OR (t.latest_non_spam_message_ts, t.id) < ($4, $5)
              )
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
            ORDER BY t.latest_non_spam_message_ts DESC, t.id DESC
            LIMIT $3
        )
        SELECT
            pt.id as "thread_id!",
            pt.latest_non_spam_message_ts as "updated_at!",
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
        ORDER BY pt.latest_non_spam_message_ts DESC, pt.id DESC
        "#,
        macro_user_id.as_ref(),
        search_pattern,
        fetch_limit,
        cursor_updated_at,
        cursor_entity_id,
    )
    .fetch_all(db)
    .await?;

    let results: Vec<EmailContactMatchThreadResult> = rows
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
            updated_at: row.updated_at,
        })
        .collect();

    // Count unique threads to determine pagination
    // Since each thread can have multiple contact matches, we paginate by thread count
    let mut seen_threads = std::collections::HashSet::new();
    let mut ordered_threads = Vec::new();
    for result in &results {
        if seen_threads.insert(result.thread_id) {
            ordered_threads.push((result.thread_id, result.updated_at));
        }
    }

    let has_more = ordered_threads.len() > limit as usize;

    // If we have more threads than limit, filter to keep only the first `limit` threads
    let (filtered_results, cursor) = if has_more {
        let threads_to_keep: std::collections::HashSet<_> = ordered_threads
            .iter()
            .take(limit as usize)
            .map(|(id, _)| *id)
            .collect();

        let filtered: Vec<_> = results
            .into_iter()
            .filter(|r| threads_to_keep.contains(&r.thread_id))
            .collect();

        // Get the cursor from the last kept thread
        let last_thread = ordered_threads.get(limit as usize - 1);
        let cursor = match last_thread {
            Some((entity_id, updated_at)) => {
                SearchCursorOption::NotDone(Some(SearchMethodCursor {
                    entity_id: *entity_id,
                    updated_at: *updated_at,
                }))
            }
            None => SearchCursorOption::Done,
        };

        (filtered, cursor)
    } else {
        (results, SearchCursorOption::Done)
    };

    Ok(PaginatedResult {
        items: filtered_results,
        cursor,
    })
}

#[cfg(test)]
mod test;
