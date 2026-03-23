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
