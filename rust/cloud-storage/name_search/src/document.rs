//! This module contains logic for searching documents by name

use chrono::{DateTime, Utc};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{NameSearchError, NameSearchResult, PaginatedResult, SearchEntityType};

/// Searches documents by IDs only
async fn ids_search(
    db: &Pool<Postgres>,
    document_ids: &[Uuid],
    search_pattern: String,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    if document_ids.is_empty() {
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
                d.id as entity_id,
                d.name,
                d."updatedAt" as updated_at
            FROM "Document" d
            WHERE d.id = ANY($1)
                AND d."deletedAt" IS NULL
                AND d.name ILIKE $2
                AND (
                    $4::timestamptz IS NULL
                    OR (d."updatedAt", d.id) < ($4, $5)
                )
            ORDER BY d."updatedAt" DESC, d.id DESC
            LIMIT $3
        "#,
        &document_ids
            .iter()
            .map(|d| d.to_string())
            .collect::<Vec<String>>(),
        search_pattern,
        fetch_limit,
        cursor_updated_at,
        cursor_entity_id,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let results: Vec<NameSearchResult> = rows
        .into_iter()
        .map(|row| NameSearchResult {
            entity_id: row.entity_id.parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            name: row.name,
            updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
        })
        .collect();

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

/// Searches documents by owner or IDs
async fn owner_search<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    document_ids: &[Uuid],
    search_pattern: String,
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
                d.id as entity_id,
                d.name,
                d."updatedAt" as updated_at
            FROM "Document" d
            WHERE (d.owner = $1 OR d.id = ANY($2))
                AND d."deletedAt" IS NULL
                AND d.name ILIKE $3
                AND (
                    $5::timestamptz IS NULL
                    OR (d."updatedAt", d.id) < ($5, $6)
                )
            ORDER BY d."updatedAt" DESC, d.id DESC
            LIMIT $4
        "#,
        macro_user_id.as_ref(),
        &document_ids
            .iter()
            .map(|d| d.to_string())
            .collect::<Vec<String>>(),
        search_pattern,
        fetch_limit,
        cursor_updated_at,
        cursor_entity_id,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let results: Vec<NameSearchResult> = rows
        .into_iter()
        .map(|row| NameSearchResult {
            entity_id: row.entity_id.parse().unwrap(),
            entity_type: SearchEntityType::Documents,
            name: row.name,
            updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
        })
        .collect();

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

/// Searches over the users documents by name
#[tracing::instrument(skip(db), err)]
pub async fn search_document_names<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    document_ids: &[Uuid],
    term: String,
    ids_only: bool,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    if term.is_empty() {
        return Err(NameSearchError::EmptySearchTerm);
    }

    let search_pattern = format!("%{term}%");

    if ids_only {
        ids_search(db, document_ids, search_pattern, limit, cursor).await
    } else {
        owner_search(
            db,
            macro_user_id,
            document_ids,
            search_pattern,
            limit,
            cursor,
        )
        .await
    }
}

#[cfg(test)]
mod test;
