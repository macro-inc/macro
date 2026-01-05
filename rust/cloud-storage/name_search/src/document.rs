//! This module contains logic for searching documents by name

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{NameSearchError, NameSearchResult, SearchEntityType};

/// Searches over the users documents by name
#[tracing::instrument(skip(db), err)]
pub async fn search_document_names<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    document_ids: &[Uuid],
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
        if document_ids.is_empty() {
            return Err(NameSearchError::EmptyIdsWithIdsOnly);
        }

        let rows = sqlx::query!(
            r#"
                SELECT
                d.id as entity_id,
                d.name -- If there is a name match name obviously name exists
                FROM "Document" d
                WHERE d.id = ANY($1)
                    AND d."deletedAt" IS NULL
                    AND d.name ILIKE $2
                ORDER BY d."updatedAt" DESC
                LIMIT $3
                OFFSET $4
            "#,
            &document_ids
                .iter()
                .map(|d| d.to_string())
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
                entity_type: SearchEntityType::Documents,
                name: row.name,
            })
            .collect())
    } else {
        let rows = sqlx::query!(
            r#"
                SELECT
                    d.id as entity_id,
                    d.name
                FROM "Document" d
                WHERE (d.owner = $1 OR d.id = ANY($2))
                    AND d."deletedAt" IS NULL
                    AND d.name ILIKE $3
                ORDER BY d."updatedAt" DESC
                LIMIT $4
                OFFSET $5
            "#,
            macro_user_id.as_ref(),
            &document_ids
                .iter()
                .map(|d| d.to_string())
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
                entity_type: SearchEntityType::Documents,
                name: row.name,
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
