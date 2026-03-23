#[cfg(test)]
mod test;

use crate::domain::{Memory, MemoryError, MemoryRepo, Result};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

pub struct PgMemoryRepo {
    inner: PgPool,
}

impl PgMemoryRepo {
    pub fn new(inner: PgPool) -> Self {
        PgMemoryRepo { inner }
    }
}

impl MemoryRepo for PgMemoryRepo {
    async fn save_memory(&self, memory: &Memory, user: MacroUserIdStr<'_>) -> Result<Uuid> {
        let id = macro_uuid::generate_uuid_v7();
        sqlx::query!(
            r#"
            INSERT INTO "Memory" (id, user_id, memory)
            VALUES ($1, $2, $3)
            "#,
            id,
            user.as_ref(),
            memory,
        )
        .execute(&self.inner)
        .await?;

        Ok(id)
    }

    async fn get_latest_memory(&self, user: MacroUserIdStr<'_>) -> Result<Memory> {
        let row = sqlx::query!(
            r#"
            SELECT memory
            FROM "Memory"
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            user.as_ref(),
        )
        .fetch_optional(&self.inner)
        .await?
        .ok_or(MemoryError::NoMemory)?;

        Ok(row.memory)
    }

    async fn get_memory_by_id(&self, user: MacroUserIdStr<'_>, id: Uuid) -> Result<Memory> {
        let row = sqlx::query!(
            r#"
            SELECT memory
            FROM "Memory"
            WHERE id = $1 AND user_id = $2
            "#,
            id,
            user.as_ref(),
        )
        .fetch_optional(&self.inner)
        .await?
        .ok_or(MemoryError::NoMemory)?;

        Ok(row.memory)
    }
}

// Scheduler queries — not part of the MemoryRepo trait.
impl PgMemoryRepo {
    /// Returns user IDs who used AI chat in the last 7 days but have no memory
    /// created in the last 7 days. Cursor-paginated by user_id.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_eligible_users_for_memory_generation(
        &self,
        cursor: Option<&MacroUserIdStr<'_>>,
        limit: i64,
    ) -> Result<Vec<MacroUserIdStr<'static>>> {
        let cursor_str = cursor.map(|c| c.as_ref().to_string());
        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT c."userId" as "user_id!"
            FROM "Chat" c
            WHERE c."deletedAt" IS NULL
              AND c."updatedAt" >= NOW() - INTERVAL '7 days'
              AND c."userId" NOT IN (
                SELECT m.user_id FROM "Memory" m
                WHERE m.created_at >= NOW() - INTERVAL '7 days'
              )
              AND ($1::text IS NULL OR c."userId" > $1)
            ORDER BY c."userId"
            LIMIT $2
            "#,
            cursor_str.as_deref(),
            limit,
        )
        .fetch_all(&self.inner)
        .await?;

        rows.into_iter()
            .map(|row| {
                MacroUserIdStr::try_from(row.user_id)
                    .map_err(|_| MemoryError::Other(anyhow::anyhow!("invalid user id in Chat table")))
            })
            .collect()
    }

    /// Returns true if the user has any memory at all.
    #[tracing::instrument(skip(self), err)]
    pub async fn user_has_any_memory(&self, user: MacroUserIdStr<'_>) -> Result<bool> {
        let exists = sqlx::query_scalar!(
            r#"
            SELECT EXISTS(SELECT 1 FROM "Memory" WHERE user_id = $1) as "exists!"
            "#,
            user.as_ref(),
        )
        .fetch_one(&self.inner)
        .await?;

        Ok(exists)
    }
}
