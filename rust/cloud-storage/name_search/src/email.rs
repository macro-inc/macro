//! This module contains logic for searching email threads by oldest message subject
#[cfg(not(test))]
use cached::proc_macro::cached;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{NameSearchError, NameSearchResult, PaginatedResult, SearchEntityType, escape_regex};

/// Searches email threads by IDs only
async fn ids_search(
    db: &Pool<Postgres>,
    thread_ids: &[Uuid],
    search_pattern: String,
    highlight_pattern: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
    importance: Option<bool>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    if thread_ids.is_empty() {
        return Err(NameSearchError::EmptyIdsWithIdsOnly);
    }

    let (cursor_updated_at, cursor_entity_id) = cursor
        .as_ref()
        .map(|c| (Some(c.updated_at), Some(c.entity_id)))
        .unwrap_or((None, None));

    // Fetch limit + 1 to determine if there are more results
    let fetch_limit = limit as i64 + 1;

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
                om.subject as "name!",
                regexp_replace(
                    om.subject,
                    $6,
                    '<macro_em>\1</macro_em>',
                    'gi'
                ) as name_highlighted,
                t.latest_non_spam_message_ts as updated_at
            FROM email_threads t
            INNER JOIN oldest_messages om ON om.thread_id = t.id
            WHERE om.subject ILIKE $2
                AND (
                    $4::timestamptz IS NULL
                    OR (t.latest_non_spam_message_ts, t.id) < ($4, $5)
                )
                AND (
                    $7::bool IS NULL
                    OR $7::bool = (NOT (
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
        thread_ids,
        search_pattern,
        fetch_limit,
        cursor_updated_at,
        cursor_entity_id,
        highlight_pattern,
        importance,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let results: Vec<NameSearchResult> = rows
        .into_iter()
        .filter_map(|row| {
            row.updated_at.map(|updated_at| NameSearchResult {
                entity_id: row.entity_id,
                entity_type: SearchEntityType::Emails,
                name: row.name_highlighted.unwrap_or(row.name),
                updated_at,
            })
        })
        .collect();

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

/// Searches email threads by owner or IDs
async fn owner_search<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    thread_ids: &[Uuid],
    search_pattern: String,
    highlight_pattern: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
    importance: Option<bool>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    let (cursor_updated_at, cursor_entity_id) = cursor
        .as_ref()
        .map(|c| (Some(c.updated_at), Some(c.entity_id)))
        .unwrap_or((None, None));

    // Fetch limit + 1 to determine if there are more results
    let fetch_limit = limit as i64 + 1;

    let rows = sqlx::query!(
        r#"
            WITH user_link_ids AS (
                SELECT id FROM email_links WHERE macro_id = $1
            ),
            matching_threads AS (
                SELECT DISTINCT thread_id
                FROM email_messages em
                WHERE em.link_id IN (SELECT id FROM user_link_ids)
                AND (thread_id = ANY($2) OR $3)
                AND em.subject ILIKE $4
            ),
            oldest_messages AS (
                SELECT DISTINCT ON (thread_id)
                    thread_id,
                    subject
                FROM email_messages
                WHERE thread_id IN (SELECT thread_id FROM matching_threads)
                ORDER BY thread_id, internal_date_ts ASC
            )
            SELECT
                t.id as entity_id,
                om.subject as "name!",
                regexp_replace(
                    om.subject,
                    $8,
                    '<macro_em>\1</macro_em>',
                    'gi'
                ) as name_highlighted,
                t.latest_non_spam_message_ts as updated_at
            FROM email_threads t
            INNER JOIN oldest_messages om ON om.thread_id = t.id
            WHERE t.link_id IN (SELECT id FROM user_link_ids)
            AND (
                $6::timestamptz IS NULL
                OR (t.latest_non_spam_message_ts, t.id) < ($6, $7)
            )
            AND (
                $9::bool IS NULL
                OR $9::bool = (NOT (
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
            LIMIT $5
        "#,
        macro_user_id.as_ref(),
        &thread_ids,
        thread_ids.is_empty(), // If empty, don't filter by thread_ids
        search_pattern,
        fetch_limit,
        cursor_updated_at,
        cursor_entity_id,
        highlight_pattern,
        importance,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let results: Vec<NameSearchResult> = rows
        .into_iter()
        .filter_map(|row| {
            row.updated_at.map(|updated_at| NameSearchResult {
                entity_id: row.entity_id,
                entity_type: SearchEntityType::Emails,
                name: row.name_highlighted.unwrap_or(row.name),
                updated_at,
            })
        })
        .collect();

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

/// Searches over email threads by the subject of the oldest message in each thread
#[tracing::instrument(skip(db), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
        result = true,
        key = "String",
        convert = r#"{ format!("{}-{:?}-{}-{}-{}-{}-{:?}", macro_user_id.as_ref(), thread_ids, term, ids_only, limit, cursor.as_ref().map(|c| format!("{}-{}", c.entity_id, c.updated_at)).unwrap_or_default(), importance) }"#
    )
)]
pub async fn search_email_subjects<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    thread_ids: &[Uuid],
    term: String,
    ids_only: bool,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
    importance: Option<bool>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    if term.is_empty() {
        return Err(NameSearchError::EmptySearchTerm);
    }

    let search_pattern = format!("%{term}%");
    let highlight_pattern = format!("({})", escape_regex(&term));

    if ids_only {
        ids_search(
            db,
            thread_ids,
            search_pattern,
            highlight_pattern,
            limit,
            cursor,
            importance,
        )
        .await
    } else {
        owner_search(
            db,
            macro_user_id,
            thread_ids,
            search_pattern,
            highlight_pattern,
            limit,
            cursor,
            importance,
        )
        .await
    }
}

#[cfg(test)]
mod test;
