//! This module contains logic for searching email threads by oldest message subject
use crate::{NameSearchError, NameSearchResult, SearchEntityType};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// Searches email threads by IDs only
async fn ids_search(
    db: &Pool<Postgres>,
    thread_ids: &[Uuid],
    search_pattern: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<NameSearchResult>, NameSearchError> {
    if thread_ids.is_empty() {
        return Err(NameSearchError::EmptyIdsWithIdsOnly);
    }

    let rows = sqlx::query!(
        r#"
            WITH oldest_messages AS (
                SELECT DISTINCT ON (thread_id)
                    thread_id,
                    subject
                FROM email_messages
                WHERE thread_id = ANY($1)
                ORDER BY thread_id, internal_date_ts ASC
            )
            SELECT
                t.id as entity_id,
                om.subject as "name!"
            FROM email_threads t
            INNER JOIN oldest_messages om ON om.thread_id = t.id
            WHERE om.subject ILIKE $2
            ORDER BY t.latest_non_spam_message_ts DESC
            LIMIT $3
            OFFSET $4
        "#,
        thread_ids,
        search_pattern,
        limit as i64,
        offset as i64,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    Ok(rows
        .into_iter()
        .map(|row| NameSearchResult {
            entity_id: row.entity_id,
            entity_type: SearchEntityType::Emails,
            name: row.name,
        })
        .collect())
}

/// Searches email threads by owner or IDs
async fn owner_search<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    thread_ids: &[Uuid],
    search_pattern: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<NameSearchResult>, NameSearchError> {
    let rows = sqlx::query!(
        r#"
            WITH oldest_messages AS (
                SELECT DISTINCT ON (thread_id)
                    thread_id,
                    subject
                FROM email_messages
                WHERE link_id IN (
                    SELECT id FROM email_links WHERE macro_id = $1
                )
                AND (thread_id = ANY($2) OR $3)
                ORDER BY thread_id, internal_date_ts ASC
            )
            SELECT
                t.id as entity_id,
                om.subject as "name!"
            FROM email_threads t
            INNER JOIN oldest_messages om ON om.thread_id = t.id
            WHERE t.link_id IN (
                SELECT id FROM email_links WHERE macro_id = $1
            )
            AND om.subject ILIKE $4
            ORDER BY t.latest_non_spam_message_ts DESC
            LIMIT $5
            OFFSET $6
        "#,
        macro_user_id.as_ref(),
        &thread_ids,
        thread_ids.is_empty(), // If empty, don't filter by thread_ids
        search_pattern,
        limit as i64,
        offset as i64,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    Ok(rows
        .into_iter()
        .map(|row| NameSearchResult {
            entity_id: row.entity_id,
            entity_type: SearchEntityType::Emails,
            name: row.name,
        })
        .collect())
}

/// Searches over email threads by the subject of the oldest message in each thread
#[tracing::instrument(skip(db), err)]
pub async fn search_email_subjects<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    thread_ids: &[Uuid],
    term: String,
    ids_only: bool,
    limit: u32,
    offset: u32,
) -> Result<Vec<NameSearchResult>, NameSearchError> {
    if term.is_empty() {
        return Err(NameSearchError::EmptySearchTerm);
    }

    let search_pattern = format!("%{term}%");

    if ids_only {
        ids_search(db, thread_ids, search_pattern, limit, offset).await
    } else {
        owner_search(db, macro_user_id, thread_ids, search_pattern, limit, offset).await
    }
}

#[cfg(test)]
mod test;
