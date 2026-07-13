#[cfg(test)]
mod test;

use crate::domain::{Memory, MemoryRepo, Result, ports::MemoryRecord};
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
        let row = sqlx::query!(
            r#"
            INSERT INTO memory (id, user_id, memory)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET memory = EXCLUDED.memory,
                updated_at = NOW()
            RETURNING id
            "#,
            id,
            user.as_ref(),
            memory,
        )
        .fetch_one(&self.inner)
        .await?;

        Ok(row.id)
    }

    async fn get_latest_memory(&self, user: MacroUserIdStr<'_>) -> Result<Option<MemoryRecord>> {
        let row = sqlx::query!(
            r#"
            SELECT memory, updated_at as "updated_at!"
            FROM memory
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
            user.as_ref(),
        )
        .fetch_optional(&self.inner)
        .await?;

        Ok(row.map(|r| MemoryRecord {
            memory: r.memory,
            updated_at: r.updated_at,
        }))
    }

    async fn get_memory_by_id(&self, user: MacroUserIdStr<'_>, id: Uuid) -> Result<Memory> {
        let row = sqlx::query!(
            r#"
            SELECT memory
            FROM memory
            WHERE id = $1 AND user_id = $2
            "#,
            id,
            user.as_ref(),
        )
        .fetch_optional(&self.inner)
        .await?
        .ok_or(crate::domain::MemoryError::NoGeneration)?;

        Ok(row.memory)
    }
}
