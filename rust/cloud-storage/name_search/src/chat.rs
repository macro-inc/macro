//! This module contains logic for searching chats by name

use chrono::{DateTime, Utc};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{NameSearchError, NameSearchResponse, NameSearchResult, SearchEntityType};

/// Searches chats by IDs only
async fn ids_search(
    db: &Pool<Postgres>,
    chat_ids: &[Uuid],
    search_pattern: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<NameSearchResponse, NameSearchError> {
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
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let mut results: Vec<NameSearchResult> = rows
        .into_iter()
        .map(|row| NameSearchResult {
            entity_id: row.entity_id.parse().unwrap(),
            entity_type: SearchEntityType::Chats,
            name: row.name,
            updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
        })
        .collect();

    // If we got more than limit, there are more results
    let has_more = results.len() > limit as usize;
    if has_more {
        results.pop(); // Remove the extra item
    }

    // Cursor is based on the last returned item
    let next_cursor = if has_more {
        SearchCursorOption::NotDone(results.last().map(|last| SearchMethodCursor {
            entity_id: last.entity_id,
            updated_at: last.updated_at,
        }))
    } else {
        SearchCursorOption::Done
    };

    Ok(NameSearchResponse {
        results,
        next_cursor,
    })
}

/// Searches chats by owner or IDs
async fn owner_search<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    chat_ids: &[Uuid],
    search_pattern: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<NameSearchResponse, NameSearchError> {
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
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let mut results: Vec<NameSearchResult> = rows
        .into_iter()
        .map(|row| NameSearchResult {
            entity_id: row.entity_id.parse().unwrap(),
            entity_type: SearchEntityType::Chats,
            name: row.name,
            updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
        })
        .collect();

    // If we got more than limit, there are more results
    let has_more = results.len() > limit as usize;
    if has_more {
        results.pop(); // Remove the extra item
    }

    // Cursor is based on the last returned item
    let next_cursor = if has_more {
        SearchCursorOption::NotDone(results.last().map(|last| SearchMethodCursor {
            entity_id: last.entity_id,
            updated_at: last.updated_at,
        }))
    } else {
        SearchCursorOption::Done
    };

    Ok(NameSearchResponse {
        results,
        next_cursor,
    })
}

/// Searches over the user's chats by name
#[tracing::instrument(skip(db), err)]
pub async fn search_chat_names<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    chat_ids: &[Uuid],
    term: String,
    ids_only: bool,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<NameSearchResponse, NameSearchError> {
    if term.is_empty() {
        return Err(NameSearchError::EmptySearchTerm);
    }

    let search_pattern = format!("%{term}%");

    if ids_only {
        ids_search(db, chat_ids, search_pattern, limit, cursor).await
    } else {
        owner_search(db, macro_user_id, chat_ids, search_pattern, limit, cursor).await
    }
}

#[cfg(test)]
mod test;
