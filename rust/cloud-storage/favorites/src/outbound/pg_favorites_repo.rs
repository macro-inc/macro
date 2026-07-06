//! PostgreSQL implementation of the [`FavoritesRepo`] port.

#[cfg(test)]
mod tests;

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use sqlx::PgPool;

use crate::domain::models::Favorite;
use crate::domain::ports::FavoritesRepo;

/// Postgres-backed favorites repository.
#[derive(Debug, Clone)]
pub struct PgFavoritesRepo {
    pool: PgPool,
}

impl PgFavoritesRepo {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Errors produced by the Postgres favorites repository.
#[derive(Debug, thiserror::Error)]
pub enum FavoritesRepoErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A stored entity type could not be parsed into [EntityType].
    #[error("invalid entity type stored for favorite: {0}")]
    InvalidEntityType(String),
}

struct FavoriteRow {
    entity_type: String,
    entity_id: String,
    sort_order: f64,
    created_at: DateTime<Utc>,
    name: Option<String>,
    file_type: Option<String>,
    document_sub_type: Option<String>,
    channel_type: Option<String>,
    channel_id: Option<String>,
}

impl FavoriteRow {
    fn into_favorite(self) -> Result<Favorite, FavoritesRepoErr> {
        let entity_type: EntityType = self
            .entity_type
            .parse()
            .map_err(|_| FavoritesRepoErr::InvalidEntityType(self.entity_type.clone()))?;
        Ok(Favorite {
            entity_type,
            entity_id: self.entity_id,
            sort_order: self.sort_order,
            created_at: self.created_at,
            name: self.name,
            file_type: self.file_type,
            document_sub_type: self.document_sub_type,
            channel_type: self.channel_type,
            channel_id: self.channel_id,
        })
    }
}

impl FavoritesRepo for PgFavoritesRepo {
    type Err = FavoritesRepoErr;

    #[tracing::instrument(err, skip(self))]
    async fn add_favorite(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<Favorite, Self::Err> {
        let entity_type: &str = entity.entity_type.into();
        let row = sqlx::query_as!(
            FavoriteRow,
            r#"
            INSERT INTO favorite (user_id, entity_type, entity_id, sort_order)
            VALUES (
                $1, $2, $3,
                COALESCE((SELECT MAX(sort_order) + 1 FROM favorite WHERE user_id = $1), 0)
            )
            ON CONFLICT (user_id, entity_type, entity_id)
                DO UPDATE SET updated_at = now()
            RETURNING
                entity_type as "entity_type!",
                entity_id as "entity_id!",
                sort_order as "sort_order!",
                created_at as "created_at!",
                NULL::text as "name?",
                NULL::text as "file_type?",
                NULL::text as "document_sub_type?",
                NULL::text as "channel_type?",
                NULL::text as "channel_id?"
            "#,
            user_id.as_ref(),
            entity_type,
            entity.entity_id.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        row.into_favorite()
    }

    #[tracing::instrument(err, skip(self))]
    async fn count_favorites(&self, user_id: &MacroUserIdStr<'_>) -> Result<i64, Self::Err> {
        let count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) as "count!" FROM favorite WHERE user_id = $1"#,
            user_id.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    #[tracing::instrument(err, skip(self))]
    async fn list_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<Favorite>, Self::Err> {
        // Resolves display metadata for the favorited entity where possible and
        // omits favorites whose target is deleted.
        let rows = sqlx::query_as!(
            FavoriteRow,
            r#"
            SELECT
                f.entity_type as "entity_type!",
                f.entity_id as "entity_id!",
                f.sort_order as "sort_order!",
                f.created_at as "created_at!",
                CASE f.entity_type
                    WHEN 'document' THEN d.name
                    WHEN 'chat' THEN c.name
                    WHEN 'project' THEN p.name
                    WHEN 'channel' THEN ch.name::text
                    WHEN 'email_thread' THEN em.subject
                END as "name?",
                d."fileType" as "file_type?",
                dt.sub_type::text as "document_sub_type?",
                ch.channel_type::text as "channel_type?",
                cm.channel_id::text as "channel_id?"
            FROM favorite f
            -- The comms/email tables key on uuid while favorite.entity_id is
            -- text. Compare in uuid (casting the favorite side) so their
            -- primary-key indexes are usable; casting the table side to text
            -- forced a full scan of each table on every listing. The regex
            -- guard keeps non-uuid entity_ids from failing the cast: they
            -- yield NULL and simply don't hydrate.
            CROSS JOIN LATERAL (
                SELECT CASE
                    WHEN f.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                        THEN f.entity_id::uuid
                END AS entity_uuid
            ) fid
            LEFT JOIN "Document" d ON f.entity_type = 'document' AND d.id = f.entity_id
            LEFT JOIN document_sub_type dt ON f.entity_type = 'document' AND dt.document_id = f.entity_id
            LEFT JOIN "Chat" c ON f.entity_type = 'chat' AND c.id = f.entity_id
            LEFT JOIN "Project" p ON f.entity_type = 'project' AND p.id = f.entity_id
            LEFT JOIN comms_channels ch ON f.entity_type = 'channel' AND ch.id = fid.entity_uuid
            LEFT JOIN comms_messages cm ON f.entity_type = 'channel_message' AND cm.id = fid.entity_uuid
            LEFT JOIN email_threads et ON f.entity_type = 'email_thread' AND et.id = fid.entity_uuid
            LEFT JOIN LATERAL (
                SELECT m.subject
                FROM email_messages m
                WHERE m.thread_id = et.id AND m.is_draft = false
                ORDER BY m.internal_date_ts DESC NULLS LAST
                LIMIT 1
            ) em ON f.entity_type = 'email_thread'
            WHERE f.user_id = $1
                AND (f.entity_type <> 'document' OR (d.id IS NOT NULL AND d."deletedAt" IS NULL))
                AND (f.entity_type <> 'chat' OR (c.id IS NOT NULL AND c."deletedAt" IS NULL))
                AND (f.entity_type <> 'project' OR (p.id IS NOT NULL AND p."deletedAt" IS NULL))
            ORDER BY f.sort_order ASC, f.created_at ASC
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(FavoriteRow::into_favorite).collect()
    }

    #[tracing::instrument(err, skip(self))]
    async fn remove_favorite_by_entity(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<bool, Self::Err> {
        let entity_type: &str = entity.entity_type.into();
        let res = sqlx::query!(
            r#"
            DELETE FROM favorite
            WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
            "#,
            user_id.as_ref(),
            entity_type,
            entity.entity_id.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self, ordered))]
    async fn reorder_favorites(
        &self,
        user_id: &MacroUserIdStr<'_>,
        ordered: &[Entity<'_>],
    ) -> Result<(), Self::Err> {
        let (entity_types, entity_ids): (Vec<String>, Vec<String>) = ordered
            .iter()
            .map(|e| {
                (
                    <&str>::from(e.entity_type).to_string(),
                    e.entity_id.to_string(),
                )
            })
            .unzip();
        sqlx::query!(
            r#"
            UPDATE favorite f
            SET sort_order = x.ord::float8 - 1, updated_at = now()
            FROM UNNEST($2::text[], $3::text[]) WITH ORDINALITY AS x(entity_type, entity_id, ord)
            WHERE f.user_id = $1
              AND f.entity_type = x.entity_type
              AND f.entity_id = x.entity_id
            "#,
            user_id.as_ref(),
            &entity_types,
            &entity_ids,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, entities))]
    async fn favorited_entities(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> Result<HashSet<Entity<'static>>, Self::Err> {
        let (entity_types, entity_ids): (Vec<String>, Vec<String>) = entities
            .iter()
            .map(|e| {
                (
                    <&str>::from(e.entity_type).to_string(),
                    e.entity_id.to_string(),
                )
            })
            .unzip();

        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT f.entity_type as "entity_type!", f.entity_id as "entity_id!"
            FROM favorite f
            JOIN UNNEST($2::text[], $3::text[]) AS w(entity_type, entity_id)
              ON w.entity_type = f.entity_type AND w.entity_id = f.entity_id
            WHERE f.user_id = $1
            "#,
            user_id.as_ref(),
            &entity_types,
            &entity_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|r| {
                let entity_type: EntityType = r
                    .entity_type
                    .parse()
                    .map_err(|_| FavoritesRepoErr::InvalidEntityType(r.entity_type.clone()))?;
                Ok(entity_type.with_entity_string(r.entity_id))
            })
            .collect()
    }
}
