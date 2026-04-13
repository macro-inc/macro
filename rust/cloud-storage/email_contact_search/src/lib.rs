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

/// Helper struct for paginating by unique threads
struct ThreadPaginationEntry {
    thread_id: uuid::Uuid,
    updated_at: DateTime<Utc>,
}

impl SearchCursorAttributes for ThreadPaginationEntry {
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
        convert = r#"{ format!("{}-{}-{}-{}-{:?}", macro_user_id.as_ref(), term, limit, cursor.as_ref().map(|c| format!("{}-{}", c.entity_id, c.updated_at)).unwrap_or_default(), importance) }"#
    )
)]
pub async fn search_email_contacts<'a>(
    db: &Pool<Postgres>,
    macro_user_id: MacroUserId<Lowercase<'a>>,
    term: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
    importance: Option<bool>,
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

    // Find threads with matching contacts, sorted by most recent activity.
    // Uses trigram indexes on contact_name/email for the ILIKE search, then
    // joins email_threads for timestamp-based ordering and cursor pagination.
    let thread_rows = sqlx::query!(
        r#"
        SELECT t.id as "thread_id!", t.latest_non_spam_message_ts as "updated_at!"
        FROM email_threads t
        WHERE t.id IN (
            SELECT DISTINCT ecsi.thread_id
            FROM email_contact_search_index ecsi
            WHERE ecsi.link_id = (SELECT id FROM email_links WHERE macro_id = $1)
              AND (ecsi.contact_name ILIKE $2 OR ecsi.contact_email ILIKE $2)
        )
        AND t.latest_non_spam_message_ts IS NOT NULL
        AND (
            $4::timestamptz IS NULL
            OR (t.latest_non_spam_message_ts, t.id) < ($4, $5)
        )
        AND (
            $6::bool IS NULL
            OR $6::bool = (NOT (
                EXISTS (
                    SELECT 1 FROM email_messages em_dep
                    JOIN email_message_labels ml_dep ON ml_dep.message_id = em_dep.id
                    JOIN email_labels l_dep ON ml_dep.label_id = l_dep.id
                    WHERE em_dep.thread_id = t.id
                    AND l_dep.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
                )
                AND NOT EXISTS (
                    SELECT 1 FROM email_messages em_pri
                    JOIN email_message_labels ml_pri ON ml_pri.message_id = em_pri.id
                    JOIN email_labels l_pri ON ml_pri.label_id = l_pri.id
                    WHERE em_pri.thread_id = t.id
                    AND l_pri.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
                )
            ))
        )
        ORDER BY t.latest_non_spam_message_ts DESC, t.id DESC
        LIMIT $3
        "#,
        macro_user_id.as_ref(),
        search_pattern,
        fetch_limit,
        cursor_updated_at,
        cursor_entity_id,
        importance,
    )
    .fetch_all(db)
    .await?;

    let thread_entries: Vec<ThreadPaginationEntry> = thread_rows
        .iter()
        .map(|row| ThreadPaginationEntry {
            thread_id: row.thread_id,
            updated_at: row.updated_at,
        })
        .collect();

    let paginated_threads = SearchCursorOption::paginate(thread_entries, limit as usize);

    let thread_ids: Vec<uuid::Uuid> = paginated_threads
        .items
        .iter()
        .map(|t| t.thread_id)
        .collect();

    if thread_ids.is_empty() {
        return Ok(PaginatedResult {
            items: vec![],
            cursor: paginated_threads.cursor,
        });
    }

    let thread_ts_map: std::collections::HashMap<uuid::Uuid, DateTime<Utc>> = paginated_threads
        .items
        .iter()
        .map(|t| (t.thread_id, t.updated_at))
        .collect();

    // Fetch contact details for the paginated threads using the idx_ecsi_link_thread
    // btree index. This avoids re-running the expensive trigram scan from the previous query.
    let contact_rows = sqlx::query!(
        r#"
        SELECT
            ecsi.thread_id as "thread_id!",
            ecsi.message_id as "message_id!",
            ecsi.contact_name as "contact_name?",
            ecsi.contact_email as "contact_email!",
            ecsi.contact_type as "contact_type!"
        FROM email_contact_search_index ecsi
        WHERE ecsi.link_id = (SELECT id FROM email_links WHERE macro_id = $1)
          AND ecsi.thread_id = ANY($2)
          AND (ecsi.contact_name ILIKE $3 OR ecsi.contact_email ILIKE $3)
        "#,
        macro_user_id.as_ref(),
        &thread_ids,
        search_pattern,
    )
    .fetch_all(db)
    .await?;

    let mut results: Vec<EmailContactMatchThreadResult> = contact_rows
        .into_iter()
        .filter_map(|row| {
            let updated_at = *thread_ts_map.get(&row.thread_id)?;
            Some(EmailContactMatchThreadResult {
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
                updated_at,
            })
        })
        .collect();

    results.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then(b.thread_id.cmp(&a.thread_id))
    });

    Ok(PaginatedResult {
        items: results,
        cursor: paginated_threads.cursor,
    })
}

#[cfg(test)]
mod test;
