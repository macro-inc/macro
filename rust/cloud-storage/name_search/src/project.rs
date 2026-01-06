//! This module contains logic for searching projects by name

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{NameSearchError, NameSearchResult, SearchEntityType};

/// Searches projects by IDs only
async fn ids_search(
    db: &Pool<Postgres>,
    project_ids: &[Uuid],
    search_pattern: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<NameSearchResult>, NameSearchError> {
    if project_ids.is_empty() {
        return Err(NameSearchError::EmptyIdsWithIdsOnly);
    }

    let rows = sqlx::query!(
        r#"
            SELECT
            p.id as entity_id,
            p.name
            FROM "Project" p
            WHERE p.id = ANY($1)
                AND p."deletedAt" IS NULL
                AND p.name ILIKE $2
            ORDER BY p."updatedAt" DESC
            LIMIT $3
            OFFSET $4
        "#,
        &project_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<String>>(),
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
            entity_id: row.entity_id.parse().unwrap(),
            entity_type: SearchEntityType::Projects,
            name: row.name,
        })
        .collect())
}

/// Searches projects by owner or IDs
async fn owner_search<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    project_ids: &[Uuid],
    search_pattern: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<NameSearchResult>, NameSearchError> {
    let rows = sqlx::query!(
        r#"
            SELECT
                p.id as entity_id,
                p.name
            FROM "Project" p
            WHERE (p."userId" = $1 OR p.id = ANY($2))
                AND p."deletedAt" IS NULL
                AND p.name ILIKE $3
            ORDER BY p."updatedAt" DESC
            LIMIT $4
            OFFSET $5
        "#,
        macro_user_id.as_ref(),
        &project_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<String>>(),
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
            entity_id: row.entity_id.parse().unwrap(),
            entity_type: SearchEntityType::Projects,
            name: row.name,
        })
        .collect())
}

/// Searches over the user's projects by name
#[tracing::instrument(skip(db), err)]
pub async fn search_project_names<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    project_ids: &[Uuid],
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
        ids_search(db, project_ids, search_pattern, limit, offset).await
    } else {
        owner_search(
            db,
            macro_user_id,
            project_ids,
            search_pattern,
            limit,
            offset,
        )
        .await
    }
}

#[cfg(test)]
mod test;
