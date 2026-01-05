//! This module contains logic for searching chats by name

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{NameSearchError, NameSearchResult, SearchEntityType};

/// Searches over the user's chats by name
#[tracing::instrument(skip(db), err)]
pub async fn search_chat_names<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    chat_ids: &[Uuid],
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
        if chat_ids.is_empty() {
            return Err(NameSearchError::EmptyIdsWithIdsOnly);
        }

        let rows = sqlx::query!(
            r#"
                SELECT
                c.id as entity_id,
                c.name
                FROM "Chat" c
                WHERE c.id = ANY($1)
                    AND c."deletedAt" IS NULL
                    AND c.name ILIKE $2
                ORDER BY c."updatedAt" DESC
                LIMIT $3
                OFFSET $4
            "#,
            &chat_ids
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
                entity_type: SearchEntityType::Chats,
                name: row.name,
            })
            .collect())
    } else {
        let rows = sqlx::query!(
            r#"
                SELECT
                    c.id as entity_id,
                    c.name
                FROM "Chat" c
                WHERE (c."userId" = $1 OR c.id = ANY($2))
                    AND c."deletedAt" IS NULL
                    AND c.name ILIKE $3
                ORDER BY c."updatedAt" DESC
                LIMIT $4
                OFFSET $5
            "#,
            macro_user_id.as_ref(),
            &chat_ids
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
                entity_type: SearchEntityType::Chats,
                name: row.name,
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
