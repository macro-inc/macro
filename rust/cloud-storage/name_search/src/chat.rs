//! This module contains logic for searching chats by name

#[cfg(not(test))]
use cached::proc_macro::cached;
use chrono::{DateTime, Utc};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{NameSearchError, NameSearchResult, PaginatedResult, SearchEntityType, escape_regex};

/// Searches chats by IDs only
async fn ids_search(
    db: &Pool<Postgres>,
    chat_ids: &[Uuid],
    search_pattern: String,
    highlight_pattern: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    if chat_ids.is_empty() {
        return Err(NameSearchError::EmptyIdsWithIdsOnly);
    }

    let (cursor_updated_at, cursor_entity_id) = cursor
        .as_ref()
        .map(|c| (Some(c.updated_at), Some(c.entity_id.to_string())))
        .unwrap_or((None, None));

    // Fetch limit + 1 to determine if there are more results
    let fetch_limit = limit as i64 + 1;

    let rows = sqlx::query!(
        r#"
            SELECT
                c.id as entity_id,
                c.name,
                regexp_replace(
                    c.name,
                    $6,
                    '<macro_em>\1</macro_em>',
                    'gi'
                ) as name_highlighted,
                c."updatedAt" as updated_at
            FROM "Chat" c
            WHERE c.id = ANY($1)
                AND c."deletedAt" IS NULL
                AND c.name ILIKE $2
                AND (
                    $4::timestamptz IS NULL
                    OR (c."updatedAt", c.id) < ($4, $5)
                )
            ORDER BY c."updatedAt" DESC, c.id DESC
            LIMIT $3
        "#,
        &chat_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<String>>(),
        search_pattern,
        fetch_limit,
        cursor_updated_at,
        cursor_entity_id,
        highlight_pattern,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let results: Vec<NameSearchResult> = rows
        .into_iter()
        .map(|row| NameSearchResult {
            entity_id: row.entity_id.parse().unwrap(),
            entity_type: SearchEntityType::Chats,
            name: row.name_highlighted.unwrap_or(row.name),
            updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
        })
        .collect();

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

/// Searches chats by owner or IDs
async fn owner_search<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    chat_ids: &[Uuid],
    search_pattern: String,
    highlight_pattern: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    let (cursor_updated_at, cursor_entity_id) = cursor
        .as_ref()
        .map(|c| (Some(c.updated_at), Some(c.entity_id.to_string())))
        .unwrap_or((None, None));

    // Fetch limit + 1 to determine if there are more results
    let fetch_limit = limit as i64 + 1;

    let rows = sqlx::query!(
        r#"
            SELECT
                c.id as entity_id,
                c.name,
                regexp_replace(
                    c.name,
                    $7,
                    '<macro_em>\1</macro_em>',
                    'gi'
                ) as name_highlighted,
                c."updatedAt" as updated_at
            FROM "Chat" c
            WHERE (c."userId" = $1 OR c.id = ANY($2))
                AND c."deletedAt" IS NULL
                AND c.name ILIKE $3
                AND (
                    $5::timestamptz IS NULL
                    OR (c."updatedAt", c.id) < ($5, $6)
                )
            ORDER BY c."updatedAt" DESC, c.id DESC
            LIMIT $4
        "#,
        macro_user_id.as_ref(),
        &chat_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<String>>(),
        search_pattern,
        fetch_limit,
        cursor_updated_at,
        cursor_entity_id,
        highlight_pattern,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let results: Vec<NameSearchResult> = rows
        .into_iter()
        .map(|row| NameSearchResult {
            entity_id: row.entity_id.parse().unwrap(),
            entity_type: SearchEntityType::Chats,
            name: row.name_highlighted.unwrap_or(row.name),
            updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
        })
        .collect();

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

/// Searches over the user's chats by name
#[tracing::instrument(skip(db), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
        result = true,
        key = "String",
        convert = r#"{ format!("{}-{:?}-{}-{}-{}-{}", macro_user_id.as_ref(), chat_ids, term, ids_only, limit, cursor.as_ref().map(|c| format!("{}-{}", c.entity_id, c.updated_at)).unwrap_or_default()) }"#
    )
)]
pub async fn search_chat_names<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    chat_ids: &[Uuid],
    term: String,
    ids_only: bool,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    if term.is_empty() {
        return Err(NameSearchError::EmptySearchTerm);
    }

    let search_pattern = format!("%{term}%");
    let highlight_pattern = format!("({})", escape_regex(&term));

    if ids_only {
        ids_search(
            db,
            chat_ids,
            search_pattern,
            highlight_pattern,
            limit,
            cursor,
        )
        .await
    } else {
        owner_search(
            db,
            macro_user_id,
            chat_ids,
            search_pattern,
            highlight_pattern,
            limit,
            cursor,
        )
        .await
    }
}

#[cfg(test)]
mod test;
